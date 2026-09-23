# Vision

I want to create a project for a personal budgeting and weath managment Application. The end goal of this app is to act as a virtual Single Family Office. I know... that's pretty ambitious. But I don't expect to get there in one shot. Instead, I want to put together a set of Initiatives to map out feature sets and Major releases. This should be fleshed out in the Pre-Discovery phase of the project... before a PRD is put together. This should be nothing more than a high level roadmap of feature clusters and ideas.

For now let's focus on what I want this Application to do. Don't try to answer all of these questions or open issues at once... Just read and digest, report back when understood. Subsequently prompt me on each issue one-by-one for clarification. Create a project\_kickoff.md file which contains all of this information and the clarifications.


# User Experience

I want the user experience to be something like these:
https://useorigin.com/
https://www.monarch.com/

... And we need to encode a design system before we start mocking things up. We should use the /design feature up front. At the heart of the app shoud be a dashboard with different views showing the financial health of the Person/Trust/Business... Along with views and annotation interfaces for transactions, Journal Entries, and Accounts.

Functionally, I want to be able to do Budgeting Things like:
- Show Expenses (Distributions) per time period... nominally months
- Categorize expenses (Distributions) and show the cash flows per time-period
- Categorize Revenue Cash Flows and tag them according to Tax Treatment
- Calculate Quarterly Extimated Taxes
- Differentiate between tax consequence expenses and Owner Spending Draws/Distributions

And do Financial Planning Things like:
- View Asset Allocation with target adjustments
- View Balance Sheets by GL Accounts and by Custodial Accounts
- Lot Based tracking of Marketable Securities. Support for GL Book valuation with depreciation / amortization / return of capital. Market based valuations on a daily basis for Equity / Net Asset Value tracking and charting. This is maybe some flavor of inventory modeling.
- **Future**: Stock research and valuation engine for stock screening
- **Future**: Monte-Carlo Simulation for simulating Portfolio survivability and extrapolated valuations. Also to show Efficient Frontier models for Asset Allocation

There are dashboard items that I have in my current workflow that will need to be built:
- A custodial Net Asset Value view: This is a balance sheet by physical holding accounts. (Custodial defined as real-life accounts held through institutions or self)
- A Delta from Previous Book Periods of the NAV above

# Some Architectural Requirements

I started doing a bit of this in another project:
https://github.com/richmosko/mosko-fintech

This is not to say that that particular playbook should be followed... It might have too may things hard-encoded to reuse. But there might be some useful things already figured out there for reference... and I feel like I designed things a bit backwards there. For this project/repo, I would like to start on the basis of what I definitely want and don't want. Not on what I'm currently doing.

## What I want

1. **Modular Design & Components**: I don't want a monolithic design that drags down the development process as every agent tries to hold full context. I want things modular so that an agent can work to a spec independantly of other agents. I would also like the boundaries to be well defined such that many agents can work in parallel as much as possible: Map out all tasks of a Milestone... Deploy many agents as possible for each task Issue.

2. **Layered Architecture**: Heirarchical Layers, where a layer is only dependant on the Layers below it, and provide services to the Layer above it. One-way dependencies are not strict... but should be a goal to aim for. Define the layers BEFORE designing the details.

3. **Defined Interfaces**: Narrow, and well defined interfaces... Especially between layers, but also between components in a layer. These are the contracts of behavior between components.

4. **Top-Down Development**: Where possible, come up with the scaffolding for the Initiative(s) and Milestones first. Infrastructure skeletons. Placeholder pages. Interface and API implementations. This is philosophical more than a hard requirement. Ideally we would get a pretty good instantiation of the frontend with mockup pages and working links before the backend is designed in earnest. Frontend pages get replaced and filled in as teh backend development matures.

5. **Double Entry Bookkeeping**: I would like a genuine modern General Ledger backend. This could be home-grown, or pulled in from open-source... Just depends on what fits out application best. We should have a research step to determine which. This should be its own Layer, I think. It needs:
   - **A Chart of Accounts**: This should follow the modern numbering format, and support heirarchical accounts (Category level, Account Level, sub-account level). Accounts are tagged as either Nominal Debit / Credit with a tagged Currency for the nomial balance.
   - **Database Tables for Accounts**: The accounts should be stored in a modern database, such as postgresql. Also Accounts are tagged by user\_id. 
   - **Database Tables for Journal Entries**: Same database... There should be a table(s) supporing multi-leg journal entries where Debits==Credits. 
   - **Support for Typical Journal Entries**: Depreciation, Amortization, Distribution, etc.
   - **Account Table Columns Denoting physical Custodial Accounts**: If any. A brokerage account could have multiple differnt kinds of assets... but on a GL they would get grouped differently.
   - **Support for Sub-Ledgers**: Most importantly, Securities sub-ledgers.
     - Do we need a Capitalization Table to track shares outstanding of the Trust/Corp/Group Entity?
     - Investment Ledger: Track Marketable Securities Lots and quantities... Track non-book market values through daily EOD Prices.
     - Do we need Inventory management for anything else? TBD

6. **Automated Transaction Importing**: Nominally, I would like a table to store transactions pulled from Plaid. Though the interface should be agnostic to Plaid, simpleFIN, Direct APIs like Schwab or Interactive Brokers. This should be a layer onto itself... possibly the lowest non-infatructure layer. Transactions would get loggled and ID'd/hashed for de-dup. Transactions would get pushed up to act as Journal Lines in Journal Entries in the GL. Multi-legged journal entries are supported... as well as split-transactions (perhaps the same mechanism). Initial transaction pulls ideally would get tagged as "draft" until confirmed by user. Once confirmed, they would be immutable. OK if this is accomplished by a "draft" staging table that is mutable.

7. **Flexible Accounting Views & Statements**: Ideally this would follow a scripting protocol of some sort (js or layerCake blocks?). But Standard Reports would be pre-seeded (Balance Sheet, Income Statement, Statement of Cash Flows).

8. **Security**: This needs to have Security and Auditability as First Class Objectives. Row Level Security on the database tables is manditory.

9. **Multi-Tenant By Design**: This should support more than one user. In fact... with the goal of a tiny Family Office Suite, Users should be able to grant access to views of account Journal Entries to other users (create Pods of users with defined managers). The details of this need to get fleshed out... but something like what Monarch Money does with shared accounts. Will need to determine how this works: at the Journal Layer? GL Layer? In any case, Row Level Security access would be on a JOIN table access credentials instead of just user\_id.

## What I do not want

1. **Ugly Design**: I get that this is ambiguous. But I want coded components that are modular, look good, and are easy to read and undertand. The goal would be for a Senior Software Engineer to look at the code and think "professional"
2. **An Expensive Stack**: I'm running all of this myself... I don't need ongoing subscriptions to 10 different service providors.
3. Implemetation\-\>Validation loops that need a FULL QA and CI/CD battery. These take forever. Structure the repo(s) and the functional elements to be small and self contained. Heirarcical... Only run the full CI/CD at higher integration loops... Have the sub-components / sub-repos versioned so that that they run much lighter CI tests that don't immediately break a stack integration that specifies a particular sub-component version. Adhere to SOLID Principles. Try to avoid full CI batteries on simple documentation updates. If peer review are reequired/gating (like security, architecture, etc), have the agent communicate to the reviewer directly *before* running the CI tests. This streamlines the review process. And lastly, we need to regularyly review the suite of CI tests to pare down for obsolecense and redundancy.


# Some Infrastructure Requirements

- I want the database backend to be PostgreSQL... a latest version.
- I want there to be OAUTH 2.0 authentication. We have used Supabase (with coolify) for self-hosting on the other repo... but ideally the stack would work something like Neon (probably + Clerk free tier... or native BetterAuth?).
- I'm open to both self-hosting on a VPS (Hertzner), or something like Vercel if we can get the backend to work somewhere.
- We are using SveltKit on the other repo and This would be my preferred starting point for the frontend. Explore a baseline UX foundation of shadcn-svelte or Flowbite Svelte, USING the built-in Components / Blocks / Charts. Charts can/should be expanded using LayerCake/LayerChart. Starting goal is to have it look kind of like this: https://www.shadcn-svelte.com/view/dashboard-01 . Again though... the end look and fee target is Monarch or Origin
- I eventually want an iOS / macOS app... so keep that in mind when determining file and infrastructure organization


# Some Development Requirements
- We will need a fake "import data" source that acts like Plaid (without actually invoking Plaid). This would be used for populating the database for development and testing... and should probably be a dedicated agent that creates randomized but normal transactions for the time period getting imported. Pre-seeding a list of transactions far into the future would also be acceptable. The reasoning for this is:
  1. Plaid won't be online from day one. There is an account and it is working in the other repo... but we shouldn't rely on it.
  2. Plaid data is REAL. This is personal data that we don't want to expose accidentally while we are developing. Certainly not for a test suite.
  3. Plaid data is Expensive. Trial connected items are free up to 10 items. But they don't reset once you delete an item. So using up the trial 10 Items costs real money. We don't want to do this and burn through Items while testing if at all possible.

- Architect and implement the codebase following SOLID principles, ensuring each class has a single responsibility. Apply YAGNI: do not write any boilerplate or structure for future use cases that are not explicitly stated in the requirements.
- Please DO NOT simply accumulate more context for the sake of more context. I have found this problem to be persistant for LLMs. Go through the effort of removing stale context in the Project files. Consolidate infomation that are similar. NEVER EVER just append logs of decisions made. This is what Git is for. Do NOT just add more lines of text that say a decision was made that invalidates a different decision: Please consolidate and remove the prior decision and state the condensed new guidelines. Take the time to run clean up sweeps after every Milestone.
- We need an accurate methodology for work time/effort estimation. This needs to be grounded in AI timeframes... not human timeframes. Proper scoping of steps required in task or Issue completion is critical, as this helps us determine if there are bloat cycles getting burnt in later development. Break down Issues into tasks(sub-issues) per team-agent. Then, break down tasks for various planning, execution, and review stages. Note dependancies where agents interact with each other. Investigate pre-built skills such as "Claude Code Time Estimator" and openspec.dev.


# Suggested Development Steps

1. Scrub the Repo of obsolete references to the project\_template starting point. Make sure that template only Milestones are removed, and log the starting releaase version of the template in STATUS.md. This is so that it is possible for project\_template updates can get ported to this repo.
2. Query the Principal (User) to approve or alter the various Workflow mechanisms that need to be nailed down before Research and Design. Things like the project mamagement system, PR and IV loop cadance, and setup of workspaces and checkout isolations.
3. The full initiative sequencing should look like this:
   A. Create the PRD: Brainstorm the Vision. Large Themes and Ideas. Stories. 
   B. UX/UI Prototyping: Create a dummy web page for defining the look and feel of the product. Landing Pages. Click flows. Navigation. Chart layouts. Deciding on a Design System to adhere to. This should be a full mock-up on a dev server. with fake and/or static data. We shold nail down the major nav bar pages and color schema(s) here. NOTE: This is THROW-AWAY CODE... so treat it as quick and dirty in its own doc directory.
   C. Create the ARCH doc: Start by exploring and defining the stack layers (both imported and built). try to create clear seperation there. Define each Layer's responsibilities and API interfaces. Try to keep functionality atomic. Only then should the layers be broken down into individual Milestones and Issues. Ensure that there are integration Milestones and Issues to connect the different layers up.
   D. Create the SEC doc: Define threat models. Define security protocols for data access (RLS) and for storing tokens / secrets. Define security protocols for infrastructure access.
   E. Create the INFRA doc:
      - Network Topology: VPSs (Virtual Private Server), firewalls, DNS setups, and other 3rd party services.
        - SMTP is with Resend (existing constraint)
      - Resource Allocation: Specifications for compute, docker compose, and any storage buckets (e.g., AWS S3).
      - Security & Compliance: IAM (Identity and Access Management) roles, encryption keys, SSL/TLS certificates, and compliance boundaries (e.g., HIPAA, GDPR).
      - Environments & CI/CD: How Production, Staging, and Development environments differ, and how code moves between them. Define a specific mechanism for deployment of database migrations. Determine how we set up CI to:
          a. localize to components
          b. ignore changes that are strictly documentary
          c. be efficient and run faster
      - Updates and Patches: Mechanism and schedules for routine Server + Packages + Services updates + reboot/downtime schedules.
      - Disaster Recovery: Backup schemes and schedules, failure monitoring and notification, and RPO/RTO targets.
      - Deployment Strategy: Goal is to create a runbook and scripts so that a novice can deploy an independant instance.
   F. I-\>V loops. At the Milestone Layers, always come up with plans to either go through each Issue one-by-one, or to one-shot the milestone with Principal review only at the end. Ask the Principal which development flow is desired for that Milestone. The PRD/ARCH/SEC/INFRA docs are living artifacts... They get updated as new information and decisions get made.


# open questions
- Any benefit to using playwright mcp for regressions?
- What phase is appropriate for writing Technical Design Documents (TDD) for non-global level components or features?
  - BTW, the ARCH doc is NOT meant to design every little detail for the system... it is meant to be high-level with focus on defining the layers and determining the shape of the APIs
  - What potential is there to use openAPI / Swagger for the API Definition
- If the solution is something other than supabase for postgresql, what is the db migration methodology for CI/CD? Actually... even with supabase, what is it?
  a. We should look at the incumbant solution from mosko-fintech
  b. no manual migrations please...
  c. How to distinguish between delpoy latest release vs deploy main?
- is there a way to architect sveltkit to support both:
  - full VPS deployment
  - free tier managed deployment a-la Vercel+Neon+Clerk?
- For git workflows: how are the different agents seperated? Do they share the same config user.name (shared with Principal)? Do they have unique ids and cloned repos as work directories? How exactly are branches used locally and in conjunction with GitHub?
- What would it take to build an MCP server that is secure to a user's data?
