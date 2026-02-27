# UI Visual Reference — n8n v2.3.6

> App URL: http://localhost:5678
> Captured at viewport: ~1440x900 (desktop, browser default)
> Date: 2026-02-27
> App: n8n Community Edition v2.3.6

---

## Screen Inventory

| Screen | Route | Screenshot | Notes |
|--------|-------|-----------|-------|
| Home (empty, no workflows) | /home/workflows | screenshots/workflow-list--empty.png | Welcome card with "Start from scratch" |
| Home (with workflow) | /home/workflows | screenshots/workflow-list--populated.png | Workflow list row layout |
| Home with sidebar expanded | /home/workflows | screenshots/sidebar--expanded.png | Shows all nav labels |
| Canvas — empty new workflow | /workflow/new | screenshots/canvas--empty.png | Dashed + node, toolbar, Logs bar |
| Canvas — with nodes | /workflow/:id | screenshots/canvas--with-nodes.png | Manual Trigger + HTTP Request nodes |
| Canvas — node selected | /workflow/:id | screenshots/canvas--node-selected.png | Context buttons visible below node |
| Canvas — after execution | /workflow/:id | screenshots/canvas--after-execution.png | Green node border, "1 item" on edge, Execute tooltip |
| Canvas — parameter pin panel | /workflow/:id | screenshots/canvas--parameter-pin-panel.png | Right panel: Fixed/Expression pin |
| Canvas — saved notification | /workflow/:id | screenshots/canvas--saved-notification.png | "Saved" status in toolbar |
| Node picker — trigger types | /workflow/new (+ click) | screenshots/node-picker--triggers.png | "What triggers this workflow?" right panel |
| Node picker — default (actions) | /workflow/:id (+ click) | screenshots/node-picker--default.png | "What happens next?" category list |
| Node picker — search results | /workflow/:id (search) | screenshots/node-picker--search.png | "http" query showing HTTP Request etc. |
| NDV — HTTP Request parameters | /workflow/:id/nodeId | screenshots/ndv--http-request-parameters.png | 3-panel: INPUT, Parameters, OUTPUT |
| NDV — Settings tab | /workflow/:id/nodeId | screenshots/ndv--settings-tab.png | SSL Certs, Always Output, Execute Once, Retry, Notes |
| NDV — Trigger output data | /workflow/:id/nodeId | screenshots/ndv--output-data.png | 2-panel trigger layout, Table/JSON/Schema toggle |
| Executions list (empty) | /home/executions | screenshots/executions--list-empty.png | Table with columns, Auto refresh checkbox |
| Executions detail | /workflow/:id/executions/1 | screenshots/executions--detail.png | Left sidebar list + readonly canvas |
| Credentials (empty) | /home/credentials | screenshots/credentials--empty.png | Lock icon empty state |
| Add credential modal | /home/credentials | screenshots/modal--add-credential.png | Dark overlay, search dropdown list |
| Settings — Usage & plan | /settings/usage | screenshots/settings--usage-plan.png | Community Edition, published workflows counter |
| Settings — Personal | /settings/personal | screenshots/settings--personal.png | Basic info form, security, 2FA |
| Settings — Users | /settings/users | screenshots/settings--users.png | User table, Invite button |
| Settings — n8n API | /settings/api | screenshots/settings--api.png | Create API key button |
| Settings — Community nodes | /settings/community-nodes | screenshots/settings--community-nodes.png | Empty state install CTA |
| Insights | /insights/total | screenshots/insights--overview.png | 5 KPI tiles, upsell for detailed charts |
| Variables (upsell) | /home/variables | screenshots/home--variables-upsell.png | Upgrade prompt for community edition |
| Templates (external) | /templates | screenshots/templates--external-site.png | Redirects to n8n.io website |

---

## Design System

### Color Palette

The primary brand color is **orange** (`hsl(7, 100%, 68%)` — approximately `#FF6B5B`). The full theme uses a neutral gray scale for backgrounds and text, with orange for accents and purple for secondary/expression contexts.

#### Brand / Primary
| Token | Value | Usage |
|-------|-------|-------|
| `--color--primary` | `hsl(7, 100%, 68%)` orange-300 | Primary buttons, active nav, links, node borders (running) |
| `--color--primary--tint-1` | `hsl(7, 100%, 88%)` | Button hover backgrounds |
| `--color--primary--tint-2` | `hsl(7, 100%, 93%)` | Subtle highlight backgrounds |
| `--color--primary--tint-3` | `hsl(7, 100%, 98%)` | Very light accent backgrounds, node executing state |

#### Secondary (Purple)
| Token | Value | Usage |
|-------|-------|-------|
| `--color--secondary` | `hsl(247, 49%, 53%)` purple-600 | Expression editor text, pinned node border, focus ring |
| `--color--secondary--shade-1` | `hsl(247, 49%, 43%)` purple-700 | JSON values, secondary link hover |
| `--color--secondary--tint-1` | `hsl(247, 49%, 83%)` | Execution waiting border |

#### Semantic Colors
| Token | Value | Usage |
|-------|-------|-------|
| `--color--success` | `hsl(147, 60%, 40%)` green-600 | Node success border, success badges |
| `--color--warning` | gold-600 | Warning states, execution running border |
| `--color--danger` | red-600 | Error states, delete buttons, warning triangle on nodes |

#### Neutral / Text Scale
| Token | Value | Usage |
|-------|-------|-------|
| `--color--text--shade-1` | `hsl(0, 0%, 17%)` neutral-850 | Primary headings, dark text |
| `--color--text` | `hsl(0, 0%, 46%)` neutral-600 | Body text |
| `--color--text--tint-1` | `hsl(0, 0%, 58%)` neutral-400 | Placeholder, muted text, icons |
| `--color--text--tint-2` | `hsl(0, 0%, 88%)` neutral-200 | Disabled text |

#### Background Scale
| Token | Value | Usage |
|-------|-------|-------|
| `--color--background--light-3` | `hsl(0, 0%, 100%)` white | Modal backgrounds, node cards, panels |
| `--color--background--light-2` | `hsl(0, 0%, 99%)` neutral-50 | Page body background |
| `--color--background` | `hsl(0, 0%, 96%)` neutral-125 | Panel secondary background, canvas |
| `--color--foreground` | `hsl(0, 0%, 88%)` neutral-200 | Dividers, borders |

### Typography

- **Primary font**: `InterVariable, sans-serif` (variable weight 100–900, woff2)
- **Code font**: `CommitMono` (variable, italic variant available)
- **Anti-aliasing**: webkit-font-smoothing antialiased

#### Font Size Scale
| Token | Value | Usage |
|-------|-------|-------|
| `--font-size--2xs` | 12px | Badges, tags, captions |
| `--font-size--xs` | 13px | Small labels |
| `--font-size--sm` | 14px | Secondary text |
| `--font-size--md` | 16px | Body text (base) |
| `--font-size--lg` | 18px | Subtitles |
| `--font-size--xl` | 20px | Section headings |
| `--font-size--2xl` | 28px | Page titles |

#### Font Weights
- `--font-weight--regular`: 400 (body, inputs)
- `--font-weight--bold`: 600 (buttons, emphasis)

### Border Radius
| Token | Value | Usage |
|-------|-------|-------|
| `--radius--sm` | 2px | Very sharp edges |
| `--radius` | 4px | Default — inputs, small cards |
| `--radius--lg` | 8px | Larger cards, node cards |
| `--radius--xl` | 12px | Modals, large panels |

The design uses rounded corners consistently. Nodes use `--radius--lg` (8px). The overall feel is slightly rounded but not pill-shaped.

### Spacing Rhythm
The spacing scale is based on multiples: 2, 4, 6, 8, 12, 16, 20, 24, 32, 48, 64, 128, 256px.

Most component padding uses `--spacing--xs` (12px) to `--spacing--md` (20px). Content padding at `--spacing--lg` (24px).

### Shadows
- Standard shadow: `0 2px 4px rgba(0,0,0,.12), 0 0 6px rgba(0,0,0,.04)`
- Card hover: `0 2px 8px rgba(68,28,23,.1)` (warm toned)
- Dark modal shadow: stronger version

### Border Style
```
--border: 1px solid var(--color--foreground)
```
All borders use 1px solid, foreground color (`hsl(0,0%,88%)`).

---

## Screen Details

### Home — Workflow List (Empty)
**Screenshot**: `./screenshots/workflow-list--empty.png`
**Layout**: Left sidebar (42px wide) + full-width main content area.
**Key UI elements**:
- Centered empty state card with a document icon (gray line icon)
- Heading: "Welcome I!" (personalized with user initial)
- Subtext: "Create your first workflow"
- Dashed-border card: "Start from scratch" with document icon
**Interactions visible**: Clicking the card opens a new workflow canvas
**UX patterns**: Warm, friendly empty state with clear single CTA

### Home — Workflow List (Populated)
**Screenshot**: `./screenshots/workflow-list--populated.png`
**Layout**: Left sidebar + main with Overview header, KPI row, tabs, workflow list.
**Key UI elements**:
- Overview heading with subtitle "All the workflows, credentials and data tables you have access to"
- KPI row: 5 metric tiles in a card container (Prod. executions, Failed, Failure rate, Time saved, Run time avg.)
- Tab bar: Workflows | Credentials | Executions | Variables | Data tables (active tab has red/orange underline)
- Search input + "Sort by last updated" dropdown + filter + view-mode buttons
- Workflow row: bold workflow name, "Last updated X ago | Created date", "Personal" badge (gray outline), deactivate icon, ellipsis menu
- Pagination: Total count, page number (coral/orange border), 50/page dropdown
- Create workflow button: coral/orange filled, top-right
**UX patterns**: List view by default, no card grid. Each workflow is a horizontal row.

### Home — Sidebar Expanded
**Screenshot**: `./screenshots/sidebar--expanded.png`
**Layout**: 200px wide expanded sidebar with n8n logo, action buttons, nav items.
**Key UI elements**:
- n8n logo (linked loops icon) + app name "n8n" in dark text
- "+" button (create new workflow)
- Sidebar toggle button (collapse icon)
- Nav items with icons + labels: Overview (house), Chat (bubble + "beta" badge in purple/secondary color)
- Bottom section: Templates (sparkle), Insights (bar chart), Help (question mark with red dot notification), Settings (gear + arrow indicating submenu)
**Interactions visible**: Toggle button collapses to icon-only mode
**UX patterns**: Two-tier nav — top section for daily-use items, bottom section for configuration/meta items

### Canvas — Empty New Workflow
**Screenshot**: `./screenshots/canvas--empty.png`
**Layout**: Full canvas area with dotted grid, top bar, bottom logs bar, right-side toolbar.
**Key UI elements**:
- Top bar: breadcrumb (Personal > My workflow), "+ Add tag" link, Publish button (disabled, gray outline), Save button (coral), history icon, ellipsis menu
- Center tab bar: Editor | Executions | Evaluations (radio-style)
- Canvas: light gray dotted grid pattern
- Center placeholder node: dashed rounded rectangle, large "+" icon, "Add first step..." label
- Right sidebar toolbar (vertical): + (add node), sticky note icon, split-view icon
- Bottom left: zoom controls (fit-to-screen, zoom in, zoom out, magic cursor)
- Bottom bar: "Logs" label + pop-out and expand buttons
**UX patterns**: Canvas is the primary editing surface. Empty state uses a placeholder node rather than a blank canvas.

### Canvas — With Nodes
**Screenshot**: `./screenshots/canvas--with-nodes.png`
**Layout**: Same as empty canvas but with nodes placed.
**Key UI elements**:
- Manual Trigger node: white rounded square (~80x80px), cursor arrow icon, connection dot on right, orange lightning bolt on left side, "When clicking 'Execute workflow'" label below
- HTTP Request node: white rounded square, blue globe icon, red warning triangle bottom-right, "HTTP Request" label, "GET:" subtitle
- Edge/connection: line from trigger's right handle to HTTP node's left handle
- Context actions on node: small icon buttons (Execute step, Deactivate, Delete, More)
- Execute workflow button: coral/orange pill button with flask icon, bottom center
- Right panel: parameter pin panel showing "Fixed | Expression" toggle and placeholder text
**UX patterns**: Nodes float on canvas, connected by visible lines. Context actions appear on hover (shown as small icon row above/below the node).

### Canvas — After Execution
**Screenshot**: `./screenshots/canvas--after-execution.png`
**Layout**: Same canvas with execution state overlays.
**Key UI elements**:
- Successful trigger node: green border (2px solid green-300)
- Green checkmark inside node (success indicator)
- "1 item" text on the edge connecting trigger to HTTP Request
- HTTP Request node: unchanged (no border change, still has warning)
- "Execute workflow" tooltip showing keyboard shortcut "⌘ ↵"
- Bottom bar: "Clear execution" button appeared
**Node states**: success=green border+checkmark, error=red, unexecuted=gray, warning=orange triangle

### Node Picker — Trigger Types
**Screenshot**: `./screenshots/node-picker--triggers.png`
**Layout**: Right-side panel slides in, ~385px wide, full height.
**Key UI elements**:
- Heading: "What triggers this workflow?"
- Subtext: "A trigger is a step that starts your workflow"
- Search input with magnifier icon (blue border when focused)
- Red vertical accent bar on left of list
- Category items with icon (gray) + bold name + description text:
  - Trigger manually
  - On app event (with arrow indicating subcategory)
  - On a schedule
  - On webhook call
  - On form submission
  - When executed by another workflow
  - On chat message
  - Other ways...
**UX patterns**: Flat list with descriptive subtitles. Arrow indicates items with subcategories. No category grouping at top level.

### Node Picker — Actions (Default)
**Screenshot**: `./screenshots/node-picker--default.png`
**Layout**: Same right panel as trigger picker.
**Key UI elements**:
- Heading: "What happens next?"
- Search input
- Red vertical left bar
- Categories: AI, Action in an app, Data transformation, Flow, Core, Human in the loop, Add another trigger
- Each category has bold name + description + arrow icon on right
**UX patterns**: Categories are clickable to drill into subcategories.

### Node Picker — Search Results
**Screenshot**: `./screenshots/node-picker--search.png`
**Layout**: Same panel with search populated.
**Key UI elements**:
- Search field shows "http" typed with clear button (x)
- Results list: HTTP Request (blue globe icon), Webhook (pink icon), HTML to PDF (orange icon with PDF badge)
- Each result: icon + bold name + description
**UX patterns**: Search narrows categories to matching nodes. Node icons are colored/branded.

### NDV — HTTP Request Parameters
**Screenshot**: `./screenshots/ndv--http-request-parameters.png`
**Layout**: Full-screen dark overlay modal. 3 equal panels horizontally.
**Key UI elements**:
- Modal header: node icon + "HTTP Request" name, "Docs" link (opens external), X close button
- Left panel (INPUT): light gray background, "No input connected" empty state with connection wire illustration and hand cursor icon
- Center panel: tabs "Parameters | Settings" with red underline on active tab, coral "Execute step" button
  - "Import cURL" secondary button
  - Method: dropdown (GET)
  - URL: text input (placeholder: http://example.com/index.html)
  - Authentication: dropdown (None)
  - Send Query Parameters: toggle switch (off)
  - Send Headers: toggle switch (off)
  - Send Body: toggle switch (off)
  - Options: "No properties" + "Add option" dropdown
  - Alert: "You can view raw requests in browser console"
  - Feedback link: "I wish this node would..."
- Right panel (OUTPUT): light gray background, arrow icon, "No output data" text, "Execute step" button, "or set mock data" link
- Draggable divider handle visible center top
**UX patterns**: 3-panel layout (Input | Parameters | Output). Parameters in center. Sections use toggle switches not checkboxes.

### NDV — Settings Tab
**Screenshot**: `./screenshots/ndv--settings-tab.png`
**Layout**: Same modal, Settings tab active.
**Key UI elements**:
- SSL Certificates: toggle (off)
- Always Output Data: toggle (off)
- Execute Once: toggle (off)
- Retry On Fail: toggle (off)
- On Error: dropdown ("Stop Workflow")
- Notes: large textarea (empty)
**UX patterns**: Per-node global settings separate from parameters.

### NDV — Trigger Node with Output Data
**Screenshot**: `./screenshots/ndv--output-data.png`
**Layout**: 2-panel layout for trigger nodes (no INPUT panel).
**Key UI elements**:
- Left panel: Parameters tab only (no Settings tab needed), info callout (orange border): "This node is where the workflow execution starts..."
- "This node does not have any parameters" text
- "I wish this node would..." feedback link
- Right panel (OUTPUT): Green checkmark next to "OUTPUT" heading (success state)
- Schema | Table | JSON view toggle (Table selected = white background, others gray)
- "1 item" count badge
- Table row: "(i) This is an item, but it's empty."
- Pin output button (pushpin icon) with tooltip "You can pin this output instead of waiting for a test event"
- Search output icon
- Edit Output button
**UX patterns**: Trigger nodes skip INPUT panel. Output has 3 view modes: Schema (structure), Table (rows), JSON (raw). Pin feature allows reusing output data.

### Executions — List (Empty)
**Screenshot**: `./screenshots/executions--list-empty.png`
**Layout**: Home page, Executions tab active.
**Key UI elements**:
- Auto refresh checkbox (checked, coral checkbox color)
- Filter button (funnel icon)
- Table header: checkbox | Workflow | Status | Started | Run Time | Exec. ID
- "No executions" placeholder text
**UX patterns**: Table-based list. Auto-refresh polling enabled by default.

### Executions — Detail View
**Screenshot**: `./screenshots/executions--detail.png`
**Layout**: Canvas switched to Executions tab. Left panel sidebar + main canvas area.
**Key UI elements**:
- Left sidebar list: execution cards with timestamp + status + duration
  - Selected card: green left border, "Feb 27, 20:21:39 | Succeeded in 6ms"
- Main area header: timestamp, "Succeeded" in green, "in 6ms | ID#1"
- "Copy to editor" button (secondary style), delete icon
- Canvas area: read-only canvas with diagonal stripe pattern overlay (to indicate non-editable)
- Trigger node: green success border + checkmark visible
- HTTP Request node: warning triangle still visible (didn't execute)
- Bottom accordion: "Which executions is this workflow saving?" (collapsed)
- Canvas zoom controls
**UX patterns**: Execution history in a left panel, selected execution shown on read-only canvas. Stripe pattern clearly communicates read-only state.

### Settings — Layout
**Screenshot**: `./screenshots/settings--usage-plan.png`
**Layout**: Left nav (230px) + main content.
**Key UI elements**:
- Back arrow "Settings" heading
- Left nav menu: Usage and plan, Personal, Users, Project roles, n8n API, External Secrets, Environments, SSO, LDAP, Log Streaming, Community nodes, Migration Report, Instance-level MCP, Chat
- Version display at bottom left: "Version 2.3.6" in orange/primary color
- Active item highlighted with gray background
**UX patterns**: Standard settings layout. Version in red at bottom for quick reference.

### Settings — Users
**Screenshot**: `./screenshots/settings--users.png`
**Layout**: Settings layout with user table.
**Key UI elements**:
- Warning callout (yellow border): "Upgrade to unlock the ability to create additional admin users"
- "Enforce two-factor authentication" toggle with "Upgrade" pill badge (disabled for community)
- Search by name or email input
- "Invite" button (coral)
- User table: Avatar | User (name + email) | Account Type | Last Active | 2FA | Projects
- User row: gradient avatar (blue/purple initials), name, email, Owner badge, "Today", "Disabled", "All projects"
**UX patterns**: Upsell notices integrated inline. User table is scannable with key metadata columns.

### Modal — Add Credential
**Screenshot**: `./screenshots/modal--add-credential.png`
**Layout**: Dark semi-transparent overlay, white centered modal.
**Key UI elements**:
- Modal: white background, rounded corners (~12px), max ~500px wide
- Header: "Add new credential"
- Subtext: "Select an app or service to connect to"
- Dropdown/combobox: "Search for app..." with magnifier icon, open state showing scrollable list
- Dropdown items: Action Network API, ActiveCampaign API, Acuity Scheduling API, etc. (alphabetical)
- X close button top-right
**UX patterns**: Modal-based credential creation. Searchable dropdown is the primary selection method (not a visual card grid). Background dimmed but not fully black.

### Insights
**Screenshot**: `./screenshots/insights--overview.png`
**Layout**: Simple page with KPI tiles and upsell.
**Key UI elements**:
- Project filter dropdown ("All projects")
- Date range picker button ("20 Feb - 27 Feb, 2026") with calendar icon
- 5 KPI tiles in a horizontal row, separated by vertical dividers:
  - Prod. executions (0, with red/orange left border on first tile indicating selected)
  - Failed prod. executions (0)
  - Failure rate (0%)
  - Time saved (--)
  - Run time avg. (0s)
- Upsell section: lock icon + "Upgrade to access more detailed insights" + description + "Upgrade" button
**UX patterns**: Summary metrics always visible even on Community plan; detailed breakdown is gated behind upgrade.

---

## Navigation Structure

### Primary Navigation (Left Sidebar)
The left sidebar is the main navigation. It is collapsible:
- **Collapsed**: 42px wide, shows icons only
- **Expanded**: 200px wide, shows icons + text labels

**Top section (main screens)**:
1. Overview (home icon) — workflow list, credentials, executions, variables
2. Chat (speech bubble) — AI chat interface [beta]

**Bottom section (meta/configuration)**:
3. Templates (sparkle icon) — links to n8n.io external template library
4. Insights (bar chart) — execution analytics
5. Help (? icon with red notification dot) — documentation, community
6. Settings (gear icon) — settings pages submenu

**Workflow canvas navigation**:
- Breadcrumb: "Personal / [workflow name]"
- Tab bar: Editor | Executions | Evaluations
- "+" tag link for adding workflow tags

### Settings Sub-navigation
Settings has its own left sidebar with sections:
Usage and plan, Personal, Users, Project roles, n8n API, External Secrets, Environments, SSO, LDAP, Log Streaming, Community nodes, Migration Report, Instance-level MCP, Chat

### Overview Tab Bar
The Overview/Home page has a second-level tab bar:
Workflows | Credentials | Executions | Variables | Data tables

---

## Interaction Patterns

### Node Manipulation (Canvas)
- **Add first node**: Click the dashed placeholder node to open trigger picker
- **Add next node**: Click the "+" handle on the right edge of any node, or use the right sidebar "+" button
- **Open node details (NDV)**: Double-click a node, or use the "Execute step" button
- **Delete node**: Single-click to select (shows context buttons), click trash icon
- **Deactivate node**: Single-click to select, click power icon
- **Move nodes**: Drag on canvas (standard React Flow drag behavior)
- **Zoom**: Bottom-left zoom controls (fit, zoom in, zoom out, magic cursor) or scroll wheel
- **Execute workflow**: Coral "Execute workflow" button bottom-center, or Cmd+Enter
- **Pin node output**: Pin icon in NDV output panel — stores output for reuse without re-running

### Node Context Actions
On single-click, 4 context buttons appear around the node:
1. Play (Execute step)
2. Power (Deactivate/Activate)
3. Trash (Delete)
4. More (...) — menu for additional actions

### Forms and Parameters
- **Fixed vs Expression toggle**: Each parameter field has a radio pair (Fixed | Expression). Expression mode enables dynamic values using n8n expression syntax.
- **Toggle switches**: Boolean parameters use pill toggles (gray=off, green/mint=on)
- **Dropdowns**: Select-style with chevron icon, opens inline listbox
- **cURL import**: HTTP Request node has special "Import cURL" button

### Workflow Lifecycle
1. Create workflow (new canvas)
2. Add trigger node
3. Add action nodes
4. Configure parameters in NDV
5. Execute (test execution)
6. Review output in NDV or Logs panel
7. Save (Cmd+S or Save button)
8. Publish (toggle to activate for production)

### Notifications
- **Save confirmation**: "Saved" text replaces Save button temporarily
- **Workflow created**: Toast notification "Workflow successfully created inside your personal space"
- **Execution result**: Toast "Workflow executed successfully"

---

## Layout Patterns

### Page Layouts
1. **Home Overview**: Left sidebar (42px) + main content with KPI row + tab bar + list
2. **Canvas Editor**: Left sidebar (42px) + full-width canvas + right panel (385px when open) + bottom bar
3. **Settings**: Left settings nav (230px) + main content (full-width form)
4. **Executions view**: Left sidebar (42px) + left panel (executions list ~380px) + main readonly canvas

### NDV (Node Detail View) Layouts
- **Action nodes**: 3 panels — INPUT (~30%) | Parameters center (~40%) | OUTPUT (~30%)
- **Trigger nodes**: 2 panels — Parameters left (~50%) | OUTPUT right (~50%)

### Panel System
- Right panel on canvas: slides in from the right (node picker, parameter pin)
- NDV: full-width dark overlay modal
- Settings: replaces canvas with page layout
- Logs: bottom drawer, collapsible

---

## Component Catalog

### Buttons

**Primary (Coral/Orange)**
- Background: `--color--primary` (orange-300)
- Text: white
- Border: orange-300
- Hover: slightly darker orange
- Disabled: washed out orange-200
- Examples: "Save", "Execute workflow", "Create workflow", "Invite", "Upgrade"

**Secondary (White with border)**
- Background: white
- Text: neutral-700
- Border: neutral-300
- Hover: orange-50 background, orange border
- Examples: "Enter activation key", "Copy to editor", "Import cURL"

**Icon buttons**: Square icon buttons with no label, gray background or transparent. Used for zoom controls, toolbar actions.

**Split button**: Coral primary button + dropdown chevron separate (e.g., "Create workflow ▾")

### Form Controls

**Text Input**
- White background, 1px neutral border
- Focus: blue/purple border (`--color--secondary`)
- Placeholder text in neutral-400
- Border radius: 4px (default)

**Dropdown/Select**
- White background, 1px neutral border, chevron icon right
- Opens as listbox below

**Toggle Switch**
- Off: gray pill (`--switch--color--background`)
- On: mint green (`--switch--color--background--active`)
- Toggle: white circle that slides

**Checkbox**
- Default: square with border
- Checked: coral/orange fill with white checkmark

**Radio**
- Editor | Executions | Evaluations tabs use radio semantics

### Navigation Items
- Sidebar icon button: 42x42px, centered icon, hover = orange icon color
- Sidebar expanded item: full width, icon + label, hover = gray background
- Settings menu item: full width text, active = gray background

### Cards
- Workflow card: full-width row with white background, subtle border, padding 16-20px
- "Start from scratch" card: dashed border, white background, centered content

### Badges / Tags
- "beta" badge: rounded pill, purple/secondary color background
- "Personal" badge: gray outline, gray text, small
- "Upgrade" badge: small gray pill on locked features

### Node Cards
- White rounded rectangle (radius ~8px)
- Icon centered (40x40px app icon)
- Label below in neutral text
- Success state: green 2px border
- Error state: red warning triangle overlay bottom-right
- Executing state: orange border
- Pinned state: purple border

### Status Colors
| Status | Color | Used for |
|--------|-------|---------|
| Succeeded | green-300 border | Node success, execution card |
| Running | orange (primary) | Node border |
| Error | red-300 | Execution card |
| Waiting | purple-300 | Execution card |
| Warning | red triangle icon | Node configuration issues |
| Pinned | purple border | Pinned node data |

### Data Display
- **Table**: Gray header row, alternating white/light rows
- **Schema view**: Tree structure showing data types
- **JSON view**: Syntax highlighted (purple keys, various value colors)
- **Item count badge**: Small number indicator on node or output header

---

## Responsive Behavior

The app is primarily designed for desktop (1440px+). At 768px (tablet):
- Sidebar collapses to icon-only mode
- Canvas remains functional but tight
- NDV may have reduced panel widths
- No dedicated mobile layout observed in the app at viewport below 768px

Breakpoints from source:
- 600px (2xs), 768px (xs), 992px (sm), 1200px (md), 1920px (lg)

---

## Top 10 UX Decisions to Preserve

1. **Orange as the sole brand color**: Every interactive element (primary buttons, active states, links, focus outlines) uses the same orange hue `hsl(7, 100%, 68%)`. This creates strong visual consistency.

2. **3-panel NDV layout**: Input | Parameters | Output shown simultaneously. This design is critical for understanding data flow through a node without switching views.

3. **Canvas as primary workspace**: The canvas takes the full available area. No persistent sidebars during editing — panels slide in from the right only when needed.

4. **Execution state on canvas**: Success/error/running states are shown directly on the node icons (colored borders + badges), not in a separate panel. "1 item" count appears on the edge.

5. **Node picker as right panel**: Instead of a modal, the node type selector slides in from the right, keeping the canvas visible for context. It searches across all node types.

6. **Fixed vs Expression toggle per field**: Every parameter field has an explicit toggle between static values and dynamic expressions. This is a core interaction pattern throughout the app.

7. **Collapsible sidebar**: The left sidebar collapses to 42px showing only icons. This maximizes canvas space without losing navigation access.

8. **Execution history as readonly canvas**: Past executions show the exact workflow state at execution time, overlaid on a read-only canvas with stripe pattern. This is more useful than a log-only view.

9. **Upsell integrated inline**: Feature locks (Variables, extra Insights, SSO, etc.) show upgrade prompts in-place within the feature's page rather than blocking the entire page. Users can always see what they're missing.

10. **Sticky notes as first-class canvas objects**: Yellow sticky note cards can be placed anywhere on the canvas, supporting documentation directly alongside the workflow logic.

---

## Gaps — Not Captured

- **Login screen**: App was already authenticated when navigated to (auto-login). The login page UI was not captured.
- **Workflow execution with real data**: HTTP Request node has no URL configured, so only trigger output was observed (empty item). Full execution output with data tables not captured.
- **Node types beyond HTTP Request and Manual Trigger**: Code node, Set node, If node, AI nodes, etc. not captured in NDV.
- **Dark mode**: The app supports dark mode (`body[data-theme='dark']`) but was only captured in light mode.
- **Error state in canvas**: A red-bordered node (execution error) was not captured.
- **Webhook/Schedule trigger nodes**: Different trigger types with different parameter layouts.
- **Chat page**: Left nav "Chat" item (beta) not explored.
- **Evaluations tab**: Third canvas tab not explored.
- **Workflow history**: History page at `/workflow/:id/history` not captured.
- **Projects page**: Found link to `/projects/L8FxXi8FMivbGVWk` but not explored.
- **Responsive at 768px**: Resize permission denied, could not capture tablet layout.
- **Hover states**: Hover permission denied, hover interactions documented from observation only.
- **Settings — External Secrets, Environments, SSO, LDAP**: Not captured (enterprise-locked features).
- **Instance-level MCP**: Not explored.
- **Data tables page**: Similar to Variables, likely has upsell content.
- **Command palette / keyboard shortcuts**: Cmd+K shortcut likely opens a command palette — not captured.
