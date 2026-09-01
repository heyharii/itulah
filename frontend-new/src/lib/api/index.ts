/** Public API boundary for cloud-hub, store-router, and dc-edge clients. */

export {
  ApiClient,
  ApiError,
  api,
  edgeApi,
  getConfiguredBaseUrl,
  getErrorMessage,
  isApiError,
  qs,
  resolveApiUrl,
  storeApi,
} from "./client"
export type {
  ApiBackend,
  ApiClientOptions,
  ApiErrorKind,
  ApiErrorOptions,
  ApiRequestOptions,
  ApiAudience,
  QueryValue,
} from "./client"
export {
  clearApiAccessToken,
  clearApiAccessTokens,
  getApiAccessToken,
  getApiAccessTokenRecord,
  setApiAccessToken,
} from "./token-store"
export type {
  ApiAccessTokenOptions,
  ApiAccessTokenRecord,
} from "./token-store"
export { API_AUDIENCES } from "./client"
export {
  toApiMutation,
  type ApiMutation,
  type ApiResource,
  type AsyncState,
  type AsyncStatus,
} from "./async-state"
export { useDomainQuery } from "./query"
export { STALE, type StaleClass, type StaleClassName } from "./stale"
export { queryClient } from "./query-client"
export {
  validateContract,
  parseContract,
  checkContract,
  routeLabel,
  onContractViolation,
  resetContractReports,
  ContractError,
  type ContractViolation,
} from "./contract"
