export function set(key: string, value: any) {
	localStorage.setItem(key, JSON.stringify(value));
}

export function get(key: string) {
	return localStorage.getItem(key);
}