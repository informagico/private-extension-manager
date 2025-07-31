export function Retry(attempts: number = 3, delay: number = 1000): MethodDecorator {
	return function (target: any, propertyKey: string | symbol, descriptor: PropertyDescriptor) {
		const originalMethod = descriptor.value;

		descriptor.value = async function (...args: any[]) {
			let lastError: any;

			for (let i = 0; i < attempts; i++) {
				try {
					return await originalMethod.apply(this, args);
				} catch (error) {
					lastError = error;

					if (i < attempts - 1) {
						await new Promise(resolve => setTimeout(resolve, delay * (i + 1)));
					}
				}
			}

			throw lastError;
		};

		return descriptor;
	};
}
