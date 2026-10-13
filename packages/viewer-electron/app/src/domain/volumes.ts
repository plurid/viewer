export interface Volume {
  path: string;
  name: string;
  total: number;
  available: number;
  removable: boolean;
  ejectable: boolean;
  readOnly: boolean;
}
