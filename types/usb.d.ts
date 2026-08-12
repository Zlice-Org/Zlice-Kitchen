// WebUSB API type definitions.
//
// Mirrors types/bluetooth.d.ts: the project does not pull @types/w3c-web-usb,
// so the surface the printer transport actually touches is declared here.

interface USBEndpoint {
  endpointNumber: number;
  direction: 'in' | 'out';
  type: 'bulk' | 'interrupt' | 'isochronous';
  packetSize: number;
}

interface USBAlternateInterface {
  alternateSetting: number;
  interfaceClass: number;
  interfaceSubclass: number;
  interfaceProtocol: number;
  interfaceName?: string;
  endpoints: USBEndpoint[];
}

interface USBInterface {
  interfaceNumber: number;
  alternate: USBAlternateInterface;
  alternates: USBAlternateInterface[];
  claimed: boolean;
}

interface USBConfiguration {
  configurationValue: number;
  configurationName?: string;
  interfaces: USBInterface[];
}

interface USBInTransferResult {
  data?: DataView;
  status: 'ok' | 'stall' | 'babble';
}

interface USBOutTransferResult {
  bytesWritten: number;
  status: 'ok' | 'stall';
}

interface USBDevice {
  readonly vendorId: number;
  readonly productId: number;
  readonly deviceClass: number;
  readonly manufacturerName?: string;
  readonly productName?: string;
  readonly serialNumber?: string;
  readonly opened: boolean;
  readonly configuration: USBConfiguration | null;
  readonly configurations: USBConfiguration[];
  open(): Promise<void>;
  close(): Promise<void>;
  forget?(): Promise<void>;
  selectConfiguration(configurationValue: number): Promise<void>;
  claimInterface(interfaceNumber: number): Promise<void>;
  releaseInterface(interfaceNumber: number): Promise<void>;
  transferOut(endpointNumber: number, data: BufferSource): Promise<USBOutTransferResult>;
  transferIn(endpointNumber: number, length: number): Promise<USBInTransferResult>;
  reset(): Promise<void>;
}

interface USBDeviceFilter {
  vendorId?: number;
  productId?: number;
  classCode?: number;
  subclassCode?: number;
  protocolCode?: number;
  serialNumber?: string;
}

interface USBDeviceRequestOptions {
  filters: USBDeviceFilter[];
}

interface USBConnectionEvent extends Event {
  readonly device: USBDevice;
}

interface USB extends EventTarget {
  getDevices(): Promise<USBDevice[]>;
  requestDevice(options: USBDeviceRequestOptions): Promise<USBDevice>;
}

interface Navigator {
  usb: USB;
}
