import DailyReport, {
  IDailyReport,
  DailyReportStatus,
  BlockerSeverity,
  IEODBlocker,
  IReviewHistoryItem,
  EODReport,
  IEODReport,
  EODReportStatus,
} from "./DailyReport";

export type IDailyWorkReport = IDailyReport;
export type DailyWorkReportStatus = DailyReportStatus;
export const DailyWorkReport = DailyReport;

export type {
  IDailyReport,
  DailyReportStatus,
  BlockerSeverity,
  IEODBlocker,
  IReviewHistoryItem,
  IEODReport,
  EODReportStatus,
};
export { DailyReport, EODReport };
export default DailyWorkReport;
