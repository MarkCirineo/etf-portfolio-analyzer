<script lang="ts">
	import type { SVGAttributes } from "svelte/elements";

	let { class: className = "", ...rest }: SVGAttributes<SVGSVGElement> = $props();
</script>

<!-- A portfolio split into its parts: three segments of a donut, in the current colour -->
<svg
	viewBox="0 0 24 24"
	fill="none"
	stroke="currentColor"
	stroke-width="4"
	class={className}
	aria-hidden="true"
	{...rest}
>
	<g transform="rotate(-90 12 12)">
		<circle cx="12" cy="12" r="8" pathLength="100" stroke-dasharray="46 54" />
		<circle
			cx="12"
			cy="12"
			r="8"
			pathLength="100"
			stroke-dasharray="26 74"
			stroke-dashoffset="-50"
			stroke-opacity="0.7"
		/>
		<circle
			cx="12"
			cy="12"
			r="8"
			pathLength="100"
			stroke-dasharray="16 84"
			stroke-dashoffset="-80"
			stroke-opacity="0.45"
		/>
	</g>
</svg>
