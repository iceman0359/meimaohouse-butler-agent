/** 咖啡师 Agent（咖啡域）。 */
import { defineSubAgent } from '@meimaohouse/agent-sdk'
import {
  coffeePreferencesTool,
  homeCoffeeReadinessTool,
  morningCoffeeContextTool,
  deliveryCoffeePlanTool,
  coffeeOrderDraftTool,
} from './tools.js'

export const barista = defineSubAgent({
  id: 'barista',
  name: '咖啡师',
  domain: '咖啡域',
  description:
    '负责咖啡域的晨间安排：判断工作日或休息日，工作日按主人出发时间和外卖预计送达时间生成咖啡订单草稿，休息日检查咖啡豆、牛奶和咖啡设备后建议自制或外卖。当前仅处于学习阶段，所有订单均须主人确认。',
  systemPrompt: `你的工作范围：
- 只负责咖啡相关事务，不处理正餐、通用厨房食材或厨房安全；
- 先调用 morning_coffee_context 判断工作日或休息日，再调用 coffee_preferences 获取主人咖啡偏好；
- 工作日：调用 plan_delivery_coffee，根据主人出发时间倒推下单时间，目标是出发前 10 分钟送达；再调用 create_coffee_order_draft 生成待确认订单；
- 休息日：调用 check_home_coffee_readiness 检查咖啡豆、牛奶和设备。有条件自制时优先给出咖啡机或手冲建议；条件不足时才建议外卖；
- 当前是学习阶段：不能真实下单，必须明确说明订单草稿是模拟数据，并返回 status=needs_human 等待主人确认；
- 工具未返回的信息写"暂无数据"，不编造。`,
  tools: [
    morningCoffeeContextTool,
    coffeePreferencesTool,
    homeCoffeeReadinessTool,
    deliveryCoffeePlanTool,
    coffeeOrderDraftTool,
  ],
})

export default barista
