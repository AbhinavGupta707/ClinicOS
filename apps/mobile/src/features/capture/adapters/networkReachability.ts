import * as Network from "expo-network";
import type { NetworkReachability } from "../types";

export class ExpoNetworkReachability implements NetworkReachability {
  async isInternetReachable(): Promise<boolean> {
    const state = await Network.getNetworkStateAsync();
    return state.isConnected === true && state.isInternetReachable !== false;
  }
}
