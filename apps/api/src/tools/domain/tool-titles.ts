import type { Locale } from '../../common/i18n/locale';

/**
 * F11.2: the tools' short titles in English (the German one is `ToolDefinition.title`) — for the
 * MCP tool list in Einstellungen › MCP and the chat's proposal cards. A tool without an entry
 * shows its German title (`tool-titles.spec.ts` keeps the list complete).
 */
export const TOOL_TITLES_EN: Readonly<Record<string, string>> = {
  calculate_project: 'Recalculate',
  get_result: 'Result',
  list_positions: 'Positions at 31.12.',
  list_income: 'Income',
  get_figure_records: 'Trace back',
  get_checks: 'Checks',
  update_open_item: 'Tick off open item',
  list_corrections: 'Corrections',
  set_price_override: 'Override price',
  reclassify_booking: 'Reclassify booking',
  create_correction: 'Add correction',
  undo_correction: 'Undo correction',
  list_exports: 'Exports',
  create_export: 'Create statement',
  get_mail_draft: 'Mail to tax advisor (draft)',
  send_mail: 'Send mail to tax advisor',
  list_mail_log: 'Sending log',
  list_files: 'List files',
  preview_file: 'File preview',
  list_row_errors: 'Row errors',
  list_hints: 'Hints',
  set_hint_status: 'Settle hint',
  assign_file: 'Assign file',
  remove_file: 'Remove file',
  upload_file: 'Upload file',
  request_file_upload: 'Request file',
  list_mappings: 'List mappings',
  get_mapping_schema: 'Mapping schema',
  get_mapping: 'Show mapping',
  create_mapping: 'Create mapping',
  update_mapping: 'Change mapping',
  reapply_mapping: 'Reapply mapping',
  delete_mapping: 'Delete mapping',
  list_projects: 'List projects',
  get_project: 'Show project',
  create_project: 'Create project',
  update_project: 'Change project',
  delete_project: 'Delete project',
  list_rates: 'Rates',
  refresh_rates: 'Refresh rates',
  apply_estv_rates: 'Apply ESTV rates',
  get_settings: 'Settings',
  update_settings: 'Change settings',
  navigate: 'Open page',
  list_wallets: 'List wallets',
  list_project_wallets: 'Wallets in the project',
  create_wallet: 'Add wallet',
  add_wallet_to_project: 'Add wallet to project',
  remove_wallet_from_project: 'Remove wallet from project',
  check_wallet_networks: 'Check networks',
  fetch_wallet: 'Fetch wallet',
};

/** The title of a tool in a language. */
export function toolTitle(
  tool: { readonly name: string; readonly title: string },
  locale: Locale,
): string {
  return locale === 'en'
    ? (TOOL_TITLES_EN[tool.name] ?? tool.title)
    : tool.title;
}

/** Both titles, for clients that switch language without asking again. */
export function toolTitles(tool: {
  readonly name: string;
  readonly title: string;
}): Readonly<Record<Locale, string>> {
  return { 'de-CH': tool.title, en: toolTitle(tool, 'en') };
}
