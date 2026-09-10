import assert from 'node:assert/strict'
import test from 'node:test'
import {
  ResultEnvelopeSchema,
  TaskRequestSchema,
  createTaskId,
  type SubAgent,
  type TaskEnvelope,
} from '@meimaohouse/agent-sdk'
import { Butler } from '@meimaohouse/butler-core'
import { chef, createChefTools } from '@meimaohouse/chef-agent'
import { cleaner } from '@meimaohouse/cleaner-agent'

test('TaskRequestSchema applies defaults', () => {
  const request = TaskRequestSchema.parse({ intent: 'inventory_check' })
  assert.deepEqual(request.params, {})
  assert.equal(request.priority, 'normal')
  assert.equal(request.source, 'human')
})

test('ResultEnvelopeSchema rejects failed without an error', () => {
  const result = ResultEnvelopeSchema.safeParse({
    task_id: 'chef_test',
    status: 'failed',
    summary: '失败',
  })
  assert.equal(result.success, false)
})

test('ResultEnvelopeSchema accepts unavailable', () => {
  const result = ResultEnvelopeSchema.safeParse({
    task_id: 'chef_test',
    status: 'unavailable',
    summary: '厨房能力尚未配置',
    error_code: 'capability_not_configured',
  })
  assert.equal(result.success, true)
})

test('Butler.delegate validates input and applies defaults', async () => {
  let received: TaskEnvelope | undefined
  const fakeSubAgent: SubAgent = {
    spec: {
      id: 'chef',
      name: '测试厨师',
      domain: '厨房域',
      description: '测试',
      systemPrompt: '测试',
    },
    createAgent: () => {
      throw new Error('不应创建模型 Agent')
    },
    handleTask: async (task) => {
      received = task
      return {
        task_id: task.task_id,
        status: 'done',
        summary: '完成',
      }
    },
    toButlerTool: () => {
      throw new Error('不应创建工具')
    },
  }

  const butler = new Butler({ subAgents: [fakeSubAgent] })
  const result = await butler.delegate({ domain: 'chef', intent: 'inventory_check' })

  assert.equal(result.status, 'done')
  assert.equal(received?.priority, 'normal')
  assert.equal(received?.source, 'human')
  assert.deepEqual(received?.params, {})
})

test('default chef and cleaner shells expose no fake tools', () => {
  assert.deepEqual(chef.spec.tools, [])
  assert.deepEqual(cleaner.spec.tools, [])
})

test('chef tools are created only when a capability is injected', async () => {
  assert.deepEqual(createChefTools(), [])

  const tools = createChefTools({
    fridgeInventory: {
      read: async () => ({
        checkedAt: '2026-01-01T00:00:00.000Z',
        items: [{ name: '牛奶', quantity: 1, unit: '盒' }],
      }),
    },
  })

  assert.equal(tools.length, 1)
  const raw = await tools[0].invoke({})
  assert.deepEqual(JSON.parse(String(raw)), {
    ok: true,
    data: {
      checkedAt: '2026-01-01T00:00:00.000Z',
      items: [{ name: '牛奶', quantity: 1, unit: '盒' }],
    },
  })
})

test('createTaskId produces unique ids', () => {
  assert.notEqual(createTaskId('chef'), createTaskId('chef'))
})
