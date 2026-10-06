/** The selected trace in the URL (`?traceId=`, or the older `?containerId=`). */
export function selectedTraceIdFromLocation(): string | null {
	const params = new URLSearchParams(window.location.search);
	return params.get("traceId") ?? params.get("containerId");
}

export function replaceTraceIdInUrl(traceId: string | null): void {
	const url = new URL(window.location.href);
	if (traceId) {
		url.searchParams.set("traceId", traceId);
		url.searchParams.delete("containerId");
	} else {
		url.searchParams.delete("traceId");
	}
	window.history.replaceState(null, "", `${url.pathname}${url.search}${url.hash}`);
}
