/**
 * EnvironmentFog (protocol component 1225).
 *
 * SDK 7.32.1 (auth-server) exports this component. The hand-rolled
 * registration used on 7.30.2 is gone: defining `core::EnvironmentFog`
 * again would clash with the one the SDK already registered.
 */
export { EnvironmentFog } from '@dcl/sdk/ecs'
