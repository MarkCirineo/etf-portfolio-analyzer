<script lang="ts">
	import { page } from "$app/state";
	import { ScenarioEditor } from "$lib/components/scenario-editor";
</script>

<svelte:head>
	<title>Edit scenario · ETF Portfolio Analyzer</title>
</svelte:head>

{#key page.params.listId}
	<ScenarioEditor listId={page.params.listId ?? null} />
{/key}
