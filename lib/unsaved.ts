/** Ask before throwing away unsaved edits. The workspace sets the flag while it has them. */
export const confirmDiscard = () =>
  typeof document === "undefined" || !document.body.dataset.unsaved || window.confirm("You have unsaved edits. Leave without saving them?");
