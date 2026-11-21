# Media Editor (spec 025)

The page at `/media-editor`: recordings browser + a tool host. Today it has one tool, Trim.

Add a tool:
1. Create `tools/<name>/<Name>Tool.tsx` — a component taking `ToolProps` (`recording`, `sessionKey`).
2. At the bottom of that file call `registerTool({ id, title, icon, component, priority })`.
3. Import the file in `MediaEditorPage.tsx` (next to `./tools/trim/TrimTool`).
4. Report unsaved edits with `useEditor().setDirty(true)` so leaving or switching recordings asks first.
5. If it writes audio, add a backend endpoint next to `trim` in `backend/src/unihelper/api/v1/media.py`
   (stage the output, then swap it in; never touch the original until the new file is complete).

The tab bar, Recordings browser, right rail and entry points need no change.
