/**
 * 咖啡师的 Strands 工具。
 * 所有 callback 都是演示实现；接入日历、设备或外卖平台后只替换对应 callback。
 */
import { tool } from '@strands-agents/sdk'
import { z } from 'zod'

const TimeSchema = z
  .string()
  .regex(/^([01]\d|2[0-3]):[0-5]\d$/, '时间必须为 HH:mm，例如 08:40')

/** 返回晨间日期类型和出发时间的演示上下文。 */
export const morningCoffeeContextTool = tool({
  name: 'morning_coffee_context',
  description: '获取晨间咖啡规划所需的日期类型、预计出发时间和当前学习阶段。',
  inputSchema: z.object({
    day_type: z.enum(['workday', 'rest_day']).describe('今天是工作日还是休息日'),
    departure_time: TimeSchema.optional().describe('工作日预计出发时间；休息日可不填'),
  }),
  callback: async (input) => {
    // TODO: 接入日历、主人配置和持久化学习状态；当前为演示数据
    return JSON.stringify({
      day_type: input.day_type,
      departure_time: input.departure_time ?? null,
      order_mode: 'learning',
      delivery_goal: input.day_type === 'workday' ? '主人出发前10分钟送达' : null,
      data_source: 'demo',
    })
  },
})

/** 返回主人咖啡喜好的演示数据。 */
export const coffeePreferencesTool = tool({
  name: 'coffee_preferences',
  description: '查询主人已确认的咖啡偏好、常点店铺和单杯预算。',
  inputSchema: z.object({}),
  callback: async () => {
    // TODO: 接入主人设置和外卖历史；当前为演示数据
    return JSON.stringify({
      favorite_drinks: ['冰美式', '热手冲咖啡'],
      preferred_store: '演示咖啡店',
      cup_size: '大杯',
      max_price_cny: 25,
      data_source: 'demo',
    })
  },
})

/** 检查休息日是否具备自制咖啡条件。 */
export const homeCoffeeReadinessTool = tool({
  name: 'check_home_coffee_readiness',
  description: '检查家中咖啡豆、牛奶、咖啡机和手冲器具是否满足自制咖啡条件。',
  inputSchema: z.object({}),
  callback: async () => {
    // TODO: 接入库存记录、智能秤或设备状态；当前为演示数据
    return JSON.stringify({
      coffee_beans: { available: true, remaining_g: 180 },
      milk: { available: true, remaining_ml: 650 },
      equipment: {
        coffee_machine: { available: true, status: 'ready' },
        pour_over: { available: true, status: 'ready' },
      },
      data_source: 'demo',
    })
  },
})

/** 按出发时间与模拟配送时长倒推工作日订单时间。 */
export const deliveryCoffeePlanTool = tool({
  name: 'plan_delivery_coffee',
  description: '根据主人出发时间、咖啡偏好和模拟外卖配送时长，生成工作日咖啡外卖的推荐下单时间。',
  inputSchema: z.object({
    departure_time: TimeSchema.describe('主人预计出发时间'),
    drink: z.string().describe('推荐的咖啡品类'),
    store: z.string().describe('推荐店铺'),
  }),
  callback: async (input) => {
    // TODO: 接入授权外卖平台或比赛提供的模拟接口；当前为固定演示报价
    const [hour, minute] = input.departure_time.split(':').map(Number)
    const departureMinutes = hour * 60 + minute
    const estimatedDeliveryMinutes = 25
    const safetyBufferMinutes = 3
    const targetArrivalMinutes = departureMinutes - 10
    const recommendedOrderMinutes = targetArrivalMinutes - estimatedDeliveryMinutes - safetyBufferMinutes

    const toTime = (minutes: number) => {
      const normalized = ((minutes % 1440) + 1440) % 1440
      return `${String(Math.floor(normalized / 60)).padStart(2, '0')}:${String(normalized % 60).padStart(2, '0')}`
    }

    return JSON.stringify({
      store: input.store,
      drink: input.drink,
      price_cny: 18,
      estimated_delivery_minutes: estimatedDeliveryMinutes,
      safety_buffer_minutes: safetyBufferMinutes,
      target_arrival_time: toTime(targetArrivalMinutes),
      recommended_order_time: toTime(recommendedOrderMinutes),
      order_mode: 'learning',
      data_source: 'demo',
    })
  },
})

/** 创建等待主人确认的模拟订单草稿，不执行真实购买。 */
export const coffeeOrderDraftTool = tool({
  name: 'create_coffee_order_draft',
  description: '根据推荐外卖方案创建待主人确认的模拟咖啡订单草稿，不会真实下单或扣款。',
  inputSchema: z.object({
    store: z.string().describe('店铺名称'),
    drink: z.string().describe('咖啡品类'),
    price_cny: z.number().positive().describe('订单总价，单位为元'),
    recommended_order_time: TimeSchema.describe('建议下单时间'),
    target_arrival_time: TimeSchema.describe('目标送达时间'),
  }),
  callback: async (input) => {
    // TODO: 接入持久化订单草稿与确认接口；当前只返回演示草稿
    return JSON.stringify({
      draft_id: `DEMO-COFFEE-${Date.now().toString(36)}`,
      ...input,
      status: 'awaiting_confirmation',
      is_simulated: true,
      message: '这是模拟订单草稿，当前版本不会真实下单或扣款。',
    })
  },
})
