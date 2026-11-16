export const reportCopyChannel = 'viewer:copy-report';
export const reportCloseChannel = 'viewer:close-report';
export const reportOptionsChannel = 'viewer:report-options';
export const reportUpdateChannel = 'viewer:report-update';
export const reportShownChannel = 'viewer:report-shown';

export interface ReportUpdate {
  revision: number;
  report: string;
  includeMessageText: boolean;
  error?: string;
}
