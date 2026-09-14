<script lang="ts">
    import { onMount } from "svelte";
    import { fetchBackendIdentity, type IdentityResult } from "./metadata";
    import { world } from "./state/world.svelte";

    let { onClose }: { onClose: () => void } = $props();

    let result: IdentityResult | null = $state(null);

    onMount(async () => {
        result = await fetchBackendIdentity();
    });

    function handleKeydown(e: KeyboardEvent) {
        if (e.key === "Escape") {
            e.preventDefault();
            onClose();
        }
    }
</script>

<svelte:window onkeydown={handleKeydown} />

<div class="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
    <div
        class="w-80 rounded border border-bg-tertiary bg-bg-secondary p-4 shadow-lg"
        role="dialog"
        aria-modal="true"
        aria-labelledby="about-title"
    >
        <div class="flex items-start justify-between gap-4">
            <h2 class="text-base font-medium text-text-primary" id="about-title">
                About AgentECS Visualizer
            </h2>
            <button
                class="text-text-muted hover:text-text-primary"
                type="button"
                onclick={onClose}
                aria-label="Close about modal"
            >
                ✕
            </button>
        </div>

        <dl class="mt-3 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-sm">
            {#if result === null}
                <dt class="text-text-muted">Backend</dt>
                <dd class="text-text-secondary">Loading…</dd>
            {:else if result.ok}
                <dt class="text-text-muted">Backend</dt>
                <dd class="text-text-primary">{result.identity.name}</dd>
                <dt class="text-text-muted">Version</dt>
                <dd class="font-mono text-text-primary">
                    {result.identity.version}
                </dd>
                <dt class="text-text-muted">Source</dt>
                <dd class="font-mono text-text-primary">
                    {result.identity.sourceType}
                </dd>
            {:else}
                <dd class="col-span-2 text-error">
                    Backend unavailable: {result.reason}
                </dd>
            {/if}

            <dt class="text-text-muted">Connection</dt>
            <dd class="text-text-primary">{world.connectionState}</dd>
            <dt class="text-text-muted">Tick</dt>
            <dd class="font-mono text-text-primary">{world.tick}</dd>
            <dt class="text-text-muted">Entities</dt>
            <dd class="font-mono text-text-primary">{world.entityCount}</dd>
        </dl>
    </div>
</div>
