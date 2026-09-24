# Spec: Issue #113 - Middle-Click to Close Session Row and Topbar Tab

## 1. Overview & Context

Users working across multiple tabs and sessions expect desktop-standard middle-click (mouse button 1) gestures to rapidly dismiss items without needing to precisely target tiny close `(x)` buttons.

Per Awen's domain model (`CONTEXT.md`), closing a Tab (layout layer) is fundamentally distinct from closing a Session (work lifecycle layer):
- **Topbar Tab**: Closes the view layout container without affecting the underlying Session entity.
- **Sidebar Session**: Closes the Session lifecycle (archiving to History and cleaning up open Views) or permanently deleting an archived Session (if already in History, guarded by confirmation).

## 2. Requirements & Behavior Matrix

### 2.1 Topbar Tab Middle-Click
1. **Trigger Gesture**:
   - `auxclick` event with `event.button === 1`.
   - Prevent default on `pointerdown` and `mousedown` for `event.button === 1` to suppress browser autoscroll compass on Windows and selection paste on Linux.
2. **Close Pipeline**:
   - Reuses existing `handleCloseTab(tabId)`.
   - Checks `remainingTabsCount > 1`. If `remainingTabsCount <= 1`, middle-click is a no-op (enforcing the minimum 1 tab invariant).
   - Checks `canCloseTab(tabId)` close guard. If guard returns false (e.g. unsaved changes cancelled by user), aborts.
   - Starts 220ms fluid width contraction animation (`data-tab-closing="true"`).
   - If closing the currently active tab, reassigns active tab immediately (0ms).
   - If closing an inactive (background) tab, the current active tab remains active without viewport switching.
3. **Renaming Guard**:
   - If the tab is currently in inline rename mode (`editingTabId === tab.id`), middle-click is ignored to prevent accidental loss of text input.

### 2.2 Sidebar Session Middle-Click
1. **Trigger Gesture**:
   - `auxclick` event with `event.button === 1`.
   - Prevent default on `pointerdown` and `mousedown` for `event.button === 1` to suppress autoscroll compass and selection paste.
2. **Active Session Row (`isClosed: false`)**:
   - Calls `commands.closeSession()`.
   - Gracefully stops running agent/terminal session processes.
   - Archives the session to History (`archiveThread` or terminal close without history deletion).
   - Removes associated Session Views across all Tabs (`store.removeSessionViews(target)`).
   - Triggers 220ms fluid height collapse animation.
   - Background action: does not shift Workbench focus or navigate URL routes.
3. **History Session Row (`isClosed: true`)**:
   - Calls `commands.deleteSession(sessionTitle)`.
   - Prompts with `requestDestructiveConfirmation`:
     *"Delete session '<title>'? This permanently clears all conversation and output history for this session."*
   - If confirmed by user: triggers 220ms fluid height collapse and permanently deletes the thread/terminal session data.
   - If cancelled or escaped: aborts with zero animation or state changes.
4. **Closing/Dragging Guard**:
   - If row is currently collapsing (`closing === true`) or being dragged, middle-click is ignored.

## 3. Architecture & ADR Alignment
- References ADR `0013-fluid-closing-and-layout-compensation.md` for 220ms Apple fluid motion easing (`cubic-bezier(0.22, 1, 0.36, 1)`) and zero-latency active tab switching.
- Documented in ADR `0014-middle-click-close-semantics.md` for middle-click semantic boundaries between presentation Tabs and domain Sessions.
