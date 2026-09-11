/**
 * 清洁域能力接口。
 *
 * 清洁机器人、洗衣机、上门服务等实现由宿主注入，仓库不保存模拟设备状态。
 */

export interface CleaningAreaStatus {
  area: string
  status: 'clean' | 'needs_cleaning' | 'in_progress'
  updatedAt: string
  note?: string
}

export interface CleaningStatus {
  areas: CleaningAreaStatus[]
}

export interface CleaningRequest {
  area: string
  mode?: 'quick' | 'standard' | 'deep'
  note?: string
}

export interface CleaningRun {
  runId: string
  status: 'started' | 'scheduled' | 'rejected'
  message?: string
}

export interface ServiceRequest {
  service: string
  preferredTime?: string
  note?: string
}

export interface ServiceBooking {
  bookingId: string
  status: 'submitted' | 'confirmed' | 'rejected'
  scheduledFor?: string
  message?: string
}

export interface LaundryStatus {
  running: boolean
  remainingMinutes?: number
  note?: string
}

export interface CleaningProvider {
  getStatus(): Promise<CleaningStatus>
  start(request: CleaningRequest): Promise<CleaningRun>
}

export interface ServiceSchedulingProvider {
  book(request: ServiceRequest): Promise<ServiceBooking>
}

export interface LaundryProvider {
  getStatus(): Promise<LaundryStatus>
}

export interface CleanerCapabilities {
  cleaning?: CleaningProvider
  scheduling?: ServiceSchedulingProvider
  laundry?: LaundryProvider
}
