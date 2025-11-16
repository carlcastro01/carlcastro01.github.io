// Lightweight wrapper around @meshtastic/js following the public docs.
// IMPORTANT: map @meshtastic/js to your local /packages build via import map in index.html.
import { Client, Protobuf, SettingsManager } from '@meshtastic/js';

export class MeshClient {
  constructor({onEvent}={}){
    this.client = new Client();
    this.connection = null;
    this.onEvent = onEvent || (()=>{});
    SettingsManager.setDebugMode?.(Protobuf.LogLevelEnum?.INFO ?? 2);
  }

  async connect(method, opts){
    if(this.connection) await this.disconnect().catch(()=>{});
    switch(method){
      case 'serial':
        this.connection = this.client.createSerialConnection();
        await this.connection.connect();
        break;
      case 'ble':
        this.connection = this.client.createBluetoothConnection();
        await this.connection.connect({ optionalServices: []});
        break;
      case 'http':
        if(!opts?.address) throw new Error('Missing IP/host');
        this.connection = this.client.createHTTPConnection();
        await this.connection.connect(opts.address);
        break;
      default:
        throw new Error('Unknown connection method');
    }
    // Subscribe to device events if available
    try {
      this.client.events?.onAny?.((ev, payload)=>this.onEvent(ev, payload));
    } catch(e){
      // No event bus available; some builds expose addListener on the connection:
      try{ this.connection?.onAny?.((ev,p)=>this.onEvent(ev,p)); }catch{}
    }
    return true;
  }

  async disconnect(){
    await this.connection?.disconnect?.();
    this.connection = null;
  }

  // Text messaging: send broadcast or to a specific node (by ID / numeric)
  async sendText({ text, destination='broadcast', channel=0, wantAck=true, priority='normal' }){
    if(!text?.trim()) throw new Error('Empty text');
    // Preferred high-level API when available
    if(this.client?.sendText){
      return this.client.sendText(text, { destination, channel, wantAck });
    }
    // Fallback: Some builds expose on connection:
    if(this.connection?.sendText){
      return this.connection.sendText(text, { destination, channel, wantAck });
    }
    // Last resort: craft a packet (requires Protobuf enums)
    const dest = (destination==='broadcast'||destination==null) ? 0xFFFF : destination;
    const pkt = {
      to: dest,
      channel,
      wantAck,
      decoded: {
        portnum: Protobuf.PortNumEnum?.TEXT_MESSAGE_APP ?? 1,
        payloadVariant: 'text',
        text: text
      }
    };
    if(this.connection?.sendPacket){
      return this.connection.sendPacket(pkt);
    }
    throw new Error('No sendText or sendPacket available on this build.');
  }

  async blinkLED(){ return this.connection?.blinkLED?.(); }
  async restartDevice(){ return this.connection?.restartDevice?.(); }

  async getStatistics(){
    return this.connection?.getStatistics?.();
  }

  async sharePosition(lat, lon, altitude=null){
    // High-level sharePosition when available
    if(this.client?.sendPosition){
      return this.client.sendPosition({ lat, lon, altitude });
    }
    // Otherwise send POSITION_APP
    const pkt = {
      to: 0xFFFF,
      channel: 0,
      wantAck: false,
      decoded: {
        portnum: Protobuf.PortNumEnum?.POSITION_APP ?? 2,
        payloadVariant: 'position',
        position: { latitudeI: Math.round(lat*1e7), longitudeI: Math.round(lon*1e7), altitude: altitude ?? 0 }
      }
    };
    return this.connection?.sendPacket?.(pkt);
  }
}
