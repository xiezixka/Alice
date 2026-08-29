<template>
  <div class="space-y-6">
    <h3 class="text-xl font-semibold mb-4 text-red-400">
      安全与命令权限
    </h3>

    <fieldset
      class="fieldset bg-gray-900/90 border-red-500/50 rounded-box w-full border p-4"
    >
      <legend class="fieldset-legend">已批准的命令</legend>
      <div class="p-2 space-y-4">
        <div class="text-sm text-gray-300 mb-4">
          这些命令可由 Alice 直接执行，无需再次批准。“本次会话允许”的命令仅在当前会话中有效。
        </div>

        <div class="overflow-x-auto">
          <table class="table table-zebra table-sm w-full">
            <thead>
              <tr>
                <th>命令</th>
                <th>批准类型</th>
                <th>操作</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="command in approvedCommands" :key="command">
                <td class="font-mono text-sm">{{ command }}</td>
                <td>
                  <span class="badge badge-success badge-sm">永久</span>
                </td>
                <td>
                  <button
                    @click="$emit('remove-command', command)"
                    class="btn btn-error btn-xs"
                    title="移除命令"
                  >
                    ✗
                  </button>
                </td>
              </tr>
              <tr
                v-for="command in sessionApprovedCommands"
                :key="'session-' + command"
              >
                <td class="font-mono text-sm">{{ command }}</td>
                <td>
                  <span class="badge badge-info badge-sm">会话</span>
                </td>
                <td>
                  <span class="text-xs text-gray-500"
                    >重启后自动移除</span
                  >
                </td>
              </tr>
            </tbody>
          </table>
        </div>

        <div
          v-if="
            approvedCommands.length === 0 &&
            sessionApprovedCommands.length === 0
          "
          class="text-center py-4 text-gray-400"
        >
          暂无已批准的命令，所有命令执行前都需要确认。
        </div>
      </div>
    </fieldset>
  </div>
</template>

<script setup lang="ts">
defineProps<{
  approvedCommands: string[]
  sessionApprovedCommands: string[]
}>()

defineEmits<{
  'remove-command': [command: string]
}>()
</script>
