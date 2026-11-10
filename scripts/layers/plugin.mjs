// Custom rules the boundaries plugin cannot express (ARCH §2.1, SECURITY A-39, A-40).
// All of them are enabled from generate.mjs; none is configured by hand.

const staticValue = (node) => {
  if (!node) return null;
  if (node.type === 'Literal' && typeof node.value === 'string') return node.value;
  if (node.type === 'TemplateLiteral' && node.expressions.length === 0) return node.quasis[0].value.cooked;
  return null;
};

const matches = (spec, list) =>
  list.some((s) => (s.endsWith('*') ? spec.startsWith(s.slice(0, -1)) : spec === s));

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

// Specifiers that must not appear in any import form: dynamic import() and require() too.
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
    };
  },
};

// Refused (architect ruling, POLY-82): SET, SET SESSION, RESET, SET LOCAL ROLE | SESSION AUTHORIZATION,
// and set_config() unless its third argument is the literal true. Other SET LOCAL passes.
const SESSION_SET = /(^|;)\s*(RESET\s+\S|SET\s+(?!LOCAL\b)\S|SET\s+LOCAL\s+(ROLE|SESSION\s+AUTHORIZATION)\b)/i;
const setConfigNotLocal = (text) => {
  for (const m of text.matchAll(/set_config\s*\(([^)]*)\)/gi)) {
    const third = m[1].split(',').slice(2).join(',').trim();
    if (!/^(true|'true')$/i.test(third)) return true;
  }
  return false;
};

const noSessionSet = {
  meta: { type: 'problem', schema: [] },
  create(context) {
    const test = (node, text) => {
      if (SESSION_SET.test(text) || setConfigNotLocal(text)) {
        context.report({ node, message: 'Session-level SET is refused (ARCH §3.3, SECURITY A-39); use SET LOCAL inside the transaction.' });
      }
    };
    return {
      Literal(node) {
        if (typeof node.value === 'string') test(node, node.value);
      },
      TemplateLiteral(node) {
        test(node, node.quasis.map((q) => q.value.cooked ?? '').join(' '));
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
