/**
 * 状态通知防闪烁标志
 *
 * 目的：在服务启动/停止期间屏蔽中间状态通知，
 * 只在操作完成后由 IPC handler 发送一次最终状态。
 */

let _transitioning = false

export const setTransitioning = (): void => {
    _transitioning = true
}

export const clearTransition = (): void => {
    _transitioning = false
}

export const isInTransition = (): boolean => _transitioning
