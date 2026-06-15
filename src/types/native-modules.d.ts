// Type declarations for optional native modules
declare module 'serialport' {
  interface PortInfo {
    path: string;
    manufacturer?: string;
    vendorId?: string;
    productId?: string;
    serialNumber?: string;
    pnpId?: string;
    locationId?: string;
    friendlyName?: string;
  }

  export class SerialPort {
    static list(): Promise<PortInfo[]>;
  }
}
