/** This flag can only restrict an isolated render-test process; ordinary desktop policy is unchanged. */
export function nativeTestRemovalsBlocked(environment: NodeJS.ProcessEnv = process.env): boolean {
  return (
    environment.VIEWER_RENDER_TEST === '1' &&
    !!environment.VIEWER_DATA_DIRECTORY &&
    environment.VIEWER_TEST_NO_REMOVAL === '1'
  );
}

export function guardTestTrash<Arguments extends unknown[], Receipt>(
  trash: (...args: Arguments) => Promise<Receipt>,
  environment: NodeJS.ProcessEnv = process.env,
): (...args: Arguments) => Promise<Receipt> {
  if (!nativeTestRemovalsBlocked(environment)) return trash;
  return async (...args) => {
    const file = typeof args[0] === 'string' ? args[0] : 'the requested item';
    throw Object.assign(new Error(`Automated native tests cannot move ${file} to the Trash.`), {
      code: 'TEST_REMOVAL_BLOCKED',
    });
  };
}

/** N-API exports are non-enumerable and non-configurable. Copy descriptors without changing the binding. */
export function guardNativeTestRemovals<
  Service extends { trash: (...args: never[]) => Promise<unknown> },
>(service: Service, environment: NodeJS.ProcessEnv = process.env): Service {
  if (!nativeTestRemovalsBlocked(environment)) return service;
  const descriptors = Object.getOwnPropertyDescriptors(service);
  for (const descriptor of Object.values(descriptors))
    if (typeof descriptor.value === 'function') descriptor.value = descriptor.value.bind(service);
  const trash = guardTestTrash(service.trash.bind(service), environment);
  descriptors.trash = { ...Object.getOwnPropertyDescriptor(service, 'trash'), value: trash };
  return Object.create(Object.getPrototypeOf(service), descriptors) as Service;
}
