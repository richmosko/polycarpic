// Custom rules the boundaries plugin cannot express (ARCH §2.1, SECURITY A-39, A-40).
// All of them are enabled from generate.mjs; none is configured by hand.

const staticValue = (node) => {
  if (!node) return null;
  if (node.type === 'Literal' && typeof node.value === 'string') return node.value;
  if (node.type === 'TemplateLiteral' && node.expressions.length === 0) return node.quasis[0].value.cooked;
  return null;
};

// gitignore-style: later entries win, a leading ! re-allows, a trailing * is a prefix, an inner * is one segment.
const toRegex = (p) =>
  new RegExp(
    '^' +
      p
        .replace(/[.+?^${}()|[\]\\]/g, (c) => '\\' + c)
        .replace(/\*$/, '\u0000')
        .replace(/\*/g, '[^/]*')
        .replace(/\u0000/, '.*') +
      '$',
  );
const matches = (spec, list) => {
  let hit = false;
  for (const entry of list) {
    const neg = entry.startsWith('!');
    if (toRegex(neg ? entry.slice(1) : entry).test(spec)) hit = !neg;
  }
  return hit;
};

const namedImportsOnly = {
  meta: {
    type: 'problem',
    schema: [{ type: 'object', properties: { specifiers: { type: 'array', items: { type: 'string' } } }, additionalProperties: false }],
  },
  create(context) {
    const list = context.options[0]?.specifiers ?? [];
    return {
      ImportDeclaration(node) {
        const spec = node.source.value;
        if (!matches(spec, list)) return;
        for (const s of node.specifiers) {
          if (s.type === 'ImportDefaultSpecifier' || s.type === 'ImportNamespaceSpecifier') {
            context.report({ node: s, message: `'${spec}' allows named imports only here; a default or namespace import reaches members the lint cannot see.` });
          }
        }
      },
      ImportExpression(node) {
        const spec = staticValue(node.source);
        if (spec !== null && matches(spec, list)) {
          context.report({ node, message: `import('${spec}') yields a namespace; '${spec}' allows named imports only here.` });
        }
      },
      CallExpression(node) {
        if (node.callee.type === 'Identifier' && node.callee.name === 'require') {
          const spec = staticValue(node.arguments[0]);
          if (spec !== null && matches(spec, list)) {
            context.report({ node, message: `require('${spec}') yields a namespace; '${spec}' allows named imports only here.` });
          }
        }
      },
    };
  },
};

// Specifiers that must not appear in any import form. The static forms are covered by
// no-restricted-imports (which ignores import() and require()); this rule closes those two.
const noBannedSpecifier = {
  meta: {
    type: 'problem',
    schema: [{ type: 'object', properties: { specifiers: { type: 'array', items: { type: 'string' } }, message: { type: 'string' } }, additionalProperties: false }],
  },
  create(context) {
    const { specifiers = [], message = 'This specifier is not allowed in this package.' } = context.options[0] ?? {};
    const check = (node, spec) => {
      if (spec !== null && matches(spec, specifiers)) context.report({ node, message: `'${spec}': ${message}` });
    };
    return {
      ImportExpression: (node) => check(node, staticValue(node.source)),
      CallExpression(node) {
        if (node.callee.type === 'Identifier' && node.callee.name === 'require') check(node, staticValue(node.arguments[0]));
      },
    };
  },
};

const noComputedImport = {
  meta: { type: 'problem', schema: [] },
  create(context) {
    const relative = (node) => {
      if (node.type === 'TemplateLiteral') return /^\.\.?\//.test(node.quasis[0].value.cooked ?? '');
      if (node.type === 'BinaryExpression' && node.operator === '+') return relative(node.left);
      return node.type === 'Literal' && /^\.\.?\//.test(String(node.value));
    };
    return {
      ImportExpression(node) {
        if (staticValue(node.source) !== null || relative(node.source)) return;
        context.report({ node, message: 'import() with a computed specifier hides a cross-package edge from the layer lint.' });
      },
      CallExpression(node) {
        if (node.callee.type !== 'Identifier' || node.callee.name !== 'require' || !node.arguments[0]) return;
        if (staticValue(node.arguments[0]) !== null || relative(node.arguments[0])) return;
        context.report({ node, message: 'require() with a computed specifier hides a cross-package edge from the layer lint.' });
      },
    };
  },
};

// Refused (architect ruling, POLY-82 + addendum 1): SET, SET SESSION (incl. CHARACTERISTICS), RESET,
// SET LOCAL ROLE | SESSION AUTHORIZATION, and set_config() unless its third argument is the literal true.
// Other SET LOCAL, SET TRANSACTION and SET CONSTRAINTS pass (transaction-scoped).
const SLOT = '\u0000';
const SESSION_SET = /(^|;)\s*(RESET\s+\S|SET\s+(?!LOCAL\b|TRANSACTION\b|CONSTRAINTS\b)\S|SET\s+LOCAL\s+(ROLE|SESSION\s+AUTHORIZATION)\b)/i;
const setConfigNotLocal = (text) => {
  for (const m of text.matchAll(/set_config\s*\(([^)]*)\)/gi)) {
    const third = m[1].split(',').slice(2).join(',').trim();
    if (!/^(true|'true')$/i.test(third)) return true;
  }
  return false;
};
const sqlText = (node) =>
  node.type === 'TemplateLiteral' ? node.quasis.map((q) => q.value.cooked ?? '').join(SLOT) : staticValue(node);
const SQL_CALLS = new Set(['raw', 'query', 'execute', 'unsafe']);
const calleeName = (c) => (c.type === 'Identifier' ? c.name : c.type === 'MemberExpression' && !c.computed ? c.property.name : null);
const objectName = (c) => (c.type === 'MemberExpression' && c.object.type === 'Identifier' ? c.object.name : null);

// mode 'all': every string and template literal (packages/db and packages/auth hold the connection and pool).
// mode 'sql': sql-tagged templates and the first argument of sql.raw / .query / .execute / .unsafe only,
// so UI copy such as "Set your password" does not trip it. Drivers are banned elsewhere, so nothing else sends SQL.
const noSessionSet = {
  meta: { type: 'problem', schema: [{ type: 'object', properties: { mode: { enum: ['all', 'sql'] } }, additionalProperties: false }] },
  create(context) {
    const mode = context.options[0]?.mode ?? 'all';
    const test = (node, text) => {
      if (text !== null && (SESSION_SET.test(text) || setConfigNotLocal(text))) {
        context.report({ node, message: 'Session-level SET is refused (ARCH §3.3, SECURITY A-39); use SET LOCAL inside the transaction.' });
      }
    };
    if (mode === 'all') {
      return {
        Literal: (node) => typeof node.value === 'string' && test(node, node.value),
        TemplateLiteral: (node) => test(node, sqlText(node)),
      };
    }
    return {
      TaggedTemplateExpression(node) {
        if (calleeName(node.tag) === 'sql' || objectName(node.tag) === 'sql') test(node, sqlText(node.quasi));
      },
      CallExpression(node) {
        const name = calleeName(node.callee);
        if (!SQL_CALLS.has(name) || !node.arguments[0]) return;
        const a = node.arguments[0];
        if (a.type === 'Literal' || a.type === 'TemplateLiteral') test(a, sqlText(a));
      },
    };
  },
};

const brandName = (t) => {
  if (!t || t.type !== 'TSTypeReference') return false;
  const n = t.typeName;
  return (n.type === 'Identifier' && n.name === 'SessionUserId') || (n.type === 'TSQualifiedName' && n.right.name === 'SessionUserId');
};

const noSessionUserIdCast = {
  meta: { type: 'problem', schema: [] },
  create(context) {
    const report = (node) =>
      context.report({ node, message: 'A cast to SessionUserId skips the brand; obtain it from the db/session constructor (SECURITY A-39).' });
    return {
      TSAsExpression: (node) => brandName(node.typeAnnotation) && report(node),
      TSTypeAssertion: (node) => brandName(node.typeAnnotation) && report(node),
      TSSatisfiesExpression: () => {},
    };
  },
};

const BANNED_MEMBERS = new Set(['encrypt', 'decrypt', 'wrapKey', 'unwrapKey']);
const ALLOWED_MEMBERS = new Set(['digest', 'sign', 'verify']);

const isGlobalCrypto = (n) =>
  (n.type === 'Identifier' && n.name === 'crypto') ||
  (n.type === 'MemberExpression' && !n.computed && n.property.name === 'crypto' &&
    n.object.type === 'Identifier' && ['globalThis', 'self', 'window', 'global'].includes(n.object.name));

const noWebcryptoMembers = {
  meta: { type: 'problem', schema: [] },
  create(context) {
    return {
      MemberExpression(node) {
        const isSubtle = !node.computed ? node.property.name === 'subtle' : staticValue(node.property) === 'subtle';
        if (!isSubtle || !isGlobalCrypto(node.object)) return;
        const p = node.parent;
        let member = null;
        if (p.type === 'MemberExpression' && p.object === node) {
          member = !p.computed ? p.property.name : staticValue(p.property);
        }
        if (member !== null && ALLOWED_MEMBERS.has(member)) return;
        const what = member !== null && BANNED_MEMBERS.has(member) ? `crypto.subtle.${member}` : 'crypto.subtle used other than for digest, sign or verify';
        context.report({ node, message: `${what} is refused outside packages/secrets (SECURITY A-39).` });
      },
    };
  },
};

export default {
  rules: {
    'named-imports-only': namedImportsOnly,
    'no-banned-specifier': noBannedSpecifier,
    'no-computed-import': noComputedImport,
    'no-session-set': noSessionSet,
    'no-session-user-id-cast': noSessionUserIdCast,
    'no-webcrypto-members': noWebcryptoMembers,
  },
};
