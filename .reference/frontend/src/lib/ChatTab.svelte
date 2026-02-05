<script lang="ts">
  import { world } from "./world.svelte";
  import { type TaskData, type AgentStateData, isTaskData, isAgentStateData } from "./types";

  interface Props {
    onNavigateToPetriDish?: () => void;
  }

  let { onNavigateToPetriDish }: Props = $props();

  // Combined agent conversation for display
  interface AgentConversation {
    entityId: number;
    archetype: string;
    task: TaskData;
    agentState: AgentStateData;
  }

  // Filter state
  let statusFilter = $state<TaskData["status"] | "all">("all");
  let searchQuery = $state("");
  let expandedCards = $state<Set<number>>(new Set());

  // Extract agent conversations from entities
  const agentConversations = $derived(() => {
    const conversations: AgentConversation[] = [];

    for (const entity of world.entities) {
      const taskComp = entity.components.find((c) => c.type_short === "Task");
      const agentStateComp = entity.components.find((c) => c.type_short === "AgentState");

      if (taskComp && agentStateComp && isTaskData(taskComp.data) && isAgentStateData(agentStateComp.data)) {
        conversations.push({
          entityId: entity.id,
          archetype: entity.archetype.join(", "),
          task: taskComp.data,
          agentState: agentStateComp.data,
        });
      }
    }

    // Sort by status priority: waiting_for_input first, then in_progress, then completed
    const priority: Record<string, number> = {
      waiting_for_input: 0,
      in_progress: 1,
      unassigned: 2,
      completed: 3,
    };
    return conversations.sort((a, b) => (priority[a.task.status] ?? 4) - (priority[b.task.status] ?? 4));
  });

  // Filtered conversations
  const filteredConversations = $derived(() => {
    let convos = agentConversations();

    if (statusFilter !== "all") {
      convos = convos.filter((c) => c.task.status === statusFilter);
    }

    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      convos = convos.filter(
        (c) =>
          c.task.description.toLowerCase().includes(q) ||
          c.task.id.toLowerCase().includes(q) ||
          c.entityId.toString().includes(q)
      );
    }

    return convos;
  });

  // Summary stats
  const stats = $derived(() => {
    const convos = agentConversations();
    return {
      total: convos.length,
      waiting: convos.filter((c) => c.task.status === "waiting_for_input").length,
      inProgress: convos.filter((c) => c.task.status === "in_progress").length,
      completed: convos.filter((c) => c.task.status === "completed").length,
    };
  });

  // Status display helper
  function getStatusDisplay(status: TaskData["status"]) {
    const mapping = {
      unassigned: {
        label: "Unassigned",
        badgeClass: "bg-[var(--color-text-muted)]/20 text-[var(--color-text-muted)]",
        borderClass: "border-l-[var(--color-text-muted)]",
        icon: "⏸️",
      },
      in_progress: {
        label: "In Progress",
        badgeClass: "bg-[var(--color-accent)]/20 text-[var(--color-accent)]",
        borderClass: "border-l-[var(--color-accent)]",
        icon: "⏳",
      },
      waiting_for_input: {
        label: "Waiting",
        badgeClass: "bg-[var(--color-warning)]/20 text-[var(--color-warning)]",
        borderClass: "border-l-[var(--color-warning)]",
        icon: "🤔",
      },
      completed: {
        label: "Completed",
        badgeClass: "bg-[var(--color-success)]/20 text-[var(--color-success)]",
        borderClass: "border-l-[var(--color-success)]",
        icon: "✅",
      },
    };
    return mapping[status] ?? mapping.unassigned;
  }

  // Toggle card expansion
  function toggleCard(entityId: number) {
    const newSet = new Set(expandedCards);
    if (newSet.has(entityId)) {
      newSet.delete(entityId);
    } else {
      newSet.add(entityId);
    }
    expandedCards = newSet;
  }

  // Navigate to entity in Petri Dish
  function viewInPetriDish(entityId: number) {
    world.selectEntity(entityId);
    onNavigateToPetriDish?.();
  }
</script>

<div class="space-y-6">
  <!-- Summary Stats -->
  <div class="grid grid-cols-2 md:grid-cols-4 gap-4">
    <div class="p-4 rounded-lg bg-[var(--color-bg-secondary)]">
      <div class="text-sm text-[var(--color-text-secondary)]">Total Conversations</div>
      <div class="text-2xl font-mono text-[var(--color-text-primary)]">{stats().total}</div>
    </div>
    <div class="p-4 rounded-lg bg-[var(--color-bg-secondary)]">
      <div class="text-sm text-[var(--color-text-secondary)]">Waiting for Input</div>
      <div class="text-2xl font-mono text-[var(--color-warning)]">{stats().waiting}</div>
    </div>
    <div class="p-4 rounded-lg bg-[var(--color-bg-secondary)]">
      <div class="text-sm text-[var(--color-text-secondary)]">In Progress</div>
      <div class="text-2xl font-mono text-[var(--color-accent)]">{stats().inProgress}</div>
    </div>
    <div class="p-4 rounded-lg bg-[var(--color-bg-secondary)]">
      <div class="text-sm text-[var(--color-text-secondary)]">Completed</div>
      <div class="text-2xl font-mono text-[var(--color-success)]">{stats().completed}</div>
    </div>
  </div>

  <!-- New Task Input (Placeholder) -->
  <div class="rounded-lg bg-[var(--color-bg-secondary)] p-4 border border-dashed border-[var(--color-bg-tertiary)]">
    <h3 class="font-medium text-[var(--color-text-secondary)] mb-2">Add New Task</h3>
    <div class="flex gap-2">
      <input
        type="text"
        disabled
        placeholder="Enter task description..."
        class="flex-1 px-3 py-2 rounded bg-[var(--color-bg-tertiary)]
               text-[var(--color-text-muted)] opacity-50 cursor-not-allowed"
      />
      <button
        disabled
        class="px-4 py-2 rounded bg-[var(--color-accent)]
               text-white opacity-50 cursor-not-allowed"
      >
        Submit
      </button>
    </div>
    <p class="text-xs text-[var(--color-text-muted)] mt-2">
      Creating new tasks requires send_action WebSocket command (not yet implemented)
    </p>
  </div>

  <!-- Conversations List -->
  <div class="rounded-lg bg-[var(--color-bg-secondary)] overflow-hidden">
    <div class="px-4 py-3 border-b border-[var(--color-bg-tertiary)] flex items-center justify-between">
      <h2 class="font-medium text-[var(--color-text-primary)]">
        Conversations
        {#if filteredConversations().length !== agentConversations().length}
          <span class="text-[var(--color-text-muted)] font-normal">
            ({filteredConversations().length} of {agentConversations().length})
          </span>
        {/if}
      </h2>
      <div class="flex items-center gap-3">
        <select
          bind:value={statusFilter}
          class="px-2 py-1 rounded bg-[var(--color-bg-tertiary)] text-sm text-[var(--color-text-primary)]
                 border-none outline-none focus:ring-1 focus:ring-[var(--color-accent)]"
        >
          <option value="all">All Status</option>
          <option value="waiting_for_input">Waiting</option>
          <option value="in_progress">In Progress</option>
          <option value="completed">Completed</option>
          <option value="unassigned">Unassigned</option>
        </select>
        <input
          type="text"
          placeholder="Search..."
          bind:value={searchQuery}
          class="px-3 py-1.5 rounded bg-[var(--color-bg-tertiary)] text-sm text-[var(--color-text-primary)]
                 placeholder-[var(--color-text-muted)] border-none outline-none focus:ring-1 focus:ring-[var(--color-accent)] w-32"
        />
      </div>
    </div>

    <div class="p-4 space-y-4 max-h-[500px] overflow-y-auto">
      {#if agentConversations().length === 0}
        <div class="text-center py-12">
          <div class="text-4xl mb-4 opacity-50">💬</div>
          <p class="text-[var(--color-text-muted)]">No agent conversations found.</p>
          <p class="text-xs text-[var(--color-text-muted)] mt-2">
            Conversations appear when entities have both Task and AgentState components.
          </p>
        </div>
      {:else if filteredConversations().length === 0}
        <p class="text-[var(--color-text-muted)] text-center py-8">No matching conversations</p>
      {:else}
        {#each filteredConversations() as convo (convo.entityId)}
          {@const statusDisplay = getStatusDisplay(convo.task.status)}
          {@const isExpanded = expandedCards.has(convo.entityId)}
          <div
            class="rounded-lg bg-[var(--color-bg-primary)] border-l-4 {statusDisplay.borderClass} p-4 space-y-3"
          >
            <!-- Header -->
            <div class="flex items-center justify-between">
              <div class="flex items-center gap-2">
                <span class="text-lg">{statusDisplay.icon}</span>
                <span class="font-mono text-sm text-[var(--color-text-secondary)]">
                  #{convo.entityId}
                </span>
                <span class="px-2 py-0.5 rounded text-xs {statusDisplay.badgeClass}">
                  {statusDisplay.label}
                </span>
              </div>
              <button
                onclick={() => viewInPetriDish(convo.entityId)}
                class="text-[var(--color-accent)] text-sm hover:underline"
              >
                View in Petri Dish
              </button>
            </div>

            <!-- Task Description -->
            <div class="text-[var(--color-text-primary)]">{convo.task.description}</div>

            <!-- Conversation History Toggle -->
            {#if convo.agentState.conversation_history.length > 0}
              <button
                onclick={() => toggleCard(convo.entityId)}
                class="text-sm text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] flex items-center gap-1"
              >
                <span class="transition-transform {isExpanded ? 'rotate-90' : ''}">▶</span>
                Conversation ({convo.agentState.conversation_history.length} messages)
              </button>

              {#if isExpanded}
                <div class="space-y-2 pl-3 border-l-2 border-[var(--color-bg-tertiary)]">
                  {#each convo.agentState.conversation_history as msg, i (i)}
                    <div class="text-sm">
                      <span
                        class="font-medium {msg.role === 'user'
                          ? 'text-[var(--color-accent)]'
                          : 'text-[var(--color-text-secondary)]'}"
                      >
                        {msg.role}:
                      </span>
                      <span class="text-[var(--color-text-primary)]">{msg.content}</span>
                    </div>
                  {/each}
                </div>
              {/if}
            {/if}

            <!-- User Query (when waiting for input) -->
            {#if convo.task.status === "waiting_for_input" && convo.task.user_query}
              <div
                class="mt-3 p-3 rounded bg-[var(--color-warning)]/10 border border-[var(--color-warning)]/30"
              >
                <div class="text-sm font-medium text-[var(--color-warning)] mb-2">
                  Agent is asking:
                </div>
                <div class="text-[var(--color-text-primary)]">{convo.task.user_query}</div>

                <!-- Response Input (Placeholder) -->
                <div class="mt-3">
                  <input
                    type="text"
                    disabled
                    placeholder="Type your response..."
                    class="w-full px-3 py-2 rounded bg-[var(--color-bg-tertiary)]
                           text-[var(--color-text-muted)] opacity-50 cursor-not-allowed"
                  />
                  <p class="text-xs text-[var(--color-text-muted)] mt-1">
                    Sending responses requires backend support
                  </p>
                </div>
              </div>
            {/if}

            <!-- Result (when completed) -->
            {#if convo.task.status === "completed" && convo.task.result}
              <div
                class="mt-3 p-3 rounded bg-[var(--color-success)]/10 border border-[var(--color-success)]/30"
              >
                <div class="text-sm font-medium text-[var(--color-success)] mb-2">Result:</div>
                <div class="text-[var(--color-text-primary)]">{convo.task.result}</div>
              </div>
            {/if}

            <!-- Iteration count -->
            <div class="text-xs text-[var(--color-text-muted)]">
              Iterations: {convo.agentState.iteration_count}
            </div>
          </div>
        {/each}
      {/if}
    </div>
  </div>
</div>
