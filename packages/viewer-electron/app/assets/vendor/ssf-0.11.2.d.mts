declare const SSF: {
  version: string;
  format(code: string | number, value: number | string, options?: { date1904?: boolean }): string;
  get_table(): Record<number, string>;
};
export default SSF;
