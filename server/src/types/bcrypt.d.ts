declare module "bcrypt" {
	export function hash(data: string, saltOrRounds: number): Promise<string>;
	export function compare(data: string, encrypted: string): Promise<boolean>;

	const bcrypt: {
		hash: typeof hash;
		compare: typeof compare;
	};

	export default bcrypt;
}
