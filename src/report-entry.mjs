// The report dialog is supplied by the shell; self-hosted copies stay inert.
// Shared results use the same settled row shape as fresh measurements.
export function updateReportEntry(button, state, openReport, prefill) {
  const hasResult = !!(state && state.verdict && (state.tokyo ||
    (state.rows || []).some(row => row && row.state !== "pending" && row.state !== "noprobe")));
  button.setAttribute("data-ms-report", prefill);
  button.hidden = typeof openReport !== "function" || !hasResult;
}
