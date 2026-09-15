import {
  AccessToken,
  EgressClient,
  IngressClient,
  RoomServiceClient,
  TokenVerifier,
  type AccessTokenOptions,
} from "livekit-server-sdk";
import type { LiveKitConfig } from "./config.js";

/**
 * Everything the tools touch, behind one interface so unit tests can inject
 * mocks and the smoke test can inject the real SDK clients.
 */
export interface LiveKitClients {
  config: LiveKitConfig;
  rooms: RoomServiceClient;
  egress: EgressClient;
  ingress: IngressClient;
  newToken: (opts?: AccessTokenOptions) => AccessToken;
  verifier: TokenVerifier;
}

export function makeClients(config: LiveKitConfig): LiveKitClients {
  return {
    config,
    rooms: new RoomServiceClient(config.apiHost, config.apiKey, config.apiSecret),
    egress: new EgressClient(config.apiHost, config.apiKey, config.apiSecret),
    ingress: new IngressClient(config.apiHost, config.apiKey, config.apiSecret),
    newToken: (opts) => new AccessToken(config.apiKey, config.apiSecret, opts),
    verifier: new TokenVerifier(config.apiKey, config.apiSecret),
  };
}
