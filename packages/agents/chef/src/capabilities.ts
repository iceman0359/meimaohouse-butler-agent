/**
 * 厨房域能力接口。
 *
 * 这里只定义宿主需要实现的能力，不包含任何模拟数据或平台实现。
 * 真实实现可以由传感器、摄像头、生鲜平台、饮食记录系统或测试替身注入。
 */

export interface FridgeItem {
  name: string
  quantity: number
  unit: string
  expiresInDays?: number
  note?: string
}

export interface FridgeInventory {
  checkedAt: string
  items: FridgeItem[]
}

export interface GroceryItem {
  name: string
  quantity: number
}

export interface GroceryOrderRequest {
  items: GroceryItem[]
  note?: string
}

export interface GroceryOrder {
  orderId: string
  status: 'submitted' | 'confirmed' | 'rejected'
  estimatedDelivery?: string
  message?: string
}

export type KitchenSafetyLevel = 'ok' | 'warning' | 'critical'

export interface KitchenSafetyItem {
  area: string
  status: KitchenSafetyLevel
  note?: string
}

export interface KitchenSafetyReport {
  checkedAt: string
  overall: KitchenSafetyLevel
  items: KitchenSafetyItem[]
}

export interface MealStats {
  days: number
  records: number
  averageCaloriesPerDay?: number
  notes?: string[]
}

export interface FridgeInventoryProvider {
  read(): Promise<FridgeInventory>
}

export interface GroceryOrderProvider {
  placeOrder(request: GroceryOrderRequest): Promise<GroceryOrder>
}

export interface KitchenSafetyProvider {
  inspect(): Promise<KitchenSafetyReport>
}

export interface MealStatsProvider {
  read(days: number): Promise<MealStats>
}

export interface ChefCapabilities {
  fridgeInventory?: FridgeInventoryProvider
  groceryOrdering?: GroceryOrderProvider
  kitchenSafety?: KitchenSafetyProvider
  mealStats?: MealStatsProvider
}
