// Central authorization layer (rule 1). Phase 1 builds this from the permission
// matrix in BRD section 4.2; every route will call it, and the client portal
// will reuse it.
//
// Until then it denies everything, so no route can be exposed by accident.
export function can(_principal, _action, _resource) {
  return false;
}
