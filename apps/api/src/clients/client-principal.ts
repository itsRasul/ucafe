export const CLIENT_PRINCIPAL = Symbol("CLIENT_PRINCIPAL");

export interface ClientPrincipal {
  clientId: string;
  sessionId: string;
  coffeeShopId: string;
}

export interface ClientAuthorizedRequest {
  [CLIENT_PRINCIPAL]?: ClientPrincipal;
}
