import 'reflect-metadata';

const INJECTABLE_METADATA_KEY = Symbol('Injectable');

export function Injectable(): ClassDecorator {
	return function (target: any) {
		// For environments without reflect-metadata, just mark the class
		if (typeof Reflect !== 'undefined' && Reflect.defineMetadata) {
			Reflect.defineMetadata(INJECTABLE_METADATA_KEY, true, target);
		}
		return target;
	};
}

export function isInjectable(target: any): boolean {
	if (typeof Reflect !== 'undefined' && Reflect.getMetadata) {
		return Reflect.getMetadata(INJECTABLE_METADATA_KEY, target) === true;
	}
	return true; // Assume injectable if reflection is not available
}
