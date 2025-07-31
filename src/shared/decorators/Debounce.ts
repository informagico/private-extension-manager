export function Debounce(delay: number = 300): MethodDecorator {
	return function (target: any, propertyKey: string | symbol, descriptor: PropertyDescriptor) {
		const originalMethod = descriptor.value;
		let timeoutId: NodeJS.Timeout;

		descriptor.value = function (...args: any[]) {
			clearTimeout(timeoutId);
			timeoutId = setTimeout(() => {
				originalMethod.apply(this, args);
			}, delay);
		};

		return descriptor;
	};
}
