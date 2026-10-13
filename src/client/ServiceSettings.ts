import React from 'react'
import type { FieldkitServiceSettings, FieldkitServiceStatus } from '../remote-types.js'
import { text, errorText, panelStyles } from './shared.js'
export type ServiceAction = 'save' | 'attach' | 'start' | 'shutdown'
interface Props {
  serviceSettings: FieldkitServiceSettings | null
  serviceStatus: FieldkitServiceStatus | null
  setServiceSettings(value: FieldkitServiceSettings): void
  shutdownConfirmed: boolean
  setShutdownConfirmed(value: boolean): void
  busy: boolean
  manageService(action: ServiceAction): void
}
export function ServiceSettings({ serviceSettings, serviceStatus, setServiceSettings, shutdownConfirmed, setShutdownConfirmed, busy, manageService }: Props) {
  const styles = panelStyles(busy)
  return React.createElement('section', { style: styles.card, 'aria-label': '服务设置' },
        React.createElement('h2', null, '服务设置'),
        React.createElement('p', null, '关闭页面或卸载插件只解除观察，服务保持独立运行。重新附着不会恢复设备连接、心跳或目标。'),
        serviceSettings && (['toolPath', 'dataDir', 'port', 'runsDir', 'odrivePython'] as const).map(key => React.createElement('label', { key, style: { display: 'block', marginBottom: 8 } },
          ({ toolPath: 'eha-tool 绝对路径', dataDir: '私有数据目录（0700）', port: '服务端口', runsDir: '记录目录（可选）', odrivePython: 'ODrive Python 绝对路径（可选）' })[key],
          React.createElement('input', { value: serviceSettings[key], type: key === 'port' ? 'number' : 'text', min: key === 'port' ? 1 : undefined, max: key === 'port' ? 65535 : undefined, disabled: busy, style: { display: 'block', width: '100%', boxSizing: 'border-box' }, onChange: (event: React.ChangeEvent<HTMLInputElement>) => setServiceSettings({ ...serviceSettings, [key]: key === 'port' ? Number(event.target.value) : event.target.value }) }))),
        React.createElement('div', { style: styles.row },
          React.createElement('button', { style: styles.button, disabled: busy || !serviceSettings, onClick: () => manageService('save') }, '保存设置'),
          React.createElement('button', { style: styles.button, disabled: busy || !serviceSettings, onClick: () => manageService('attach') }, '发现 / 附着服务'),
          React.createElement('button', { style: styles.button, disabled: busy || !serviceSettings, onClick: () => manageService('start') }, '启动服务')),
        serviceStatus?.error && React.createElement('p', { role: 'alert' }, errorText(serviceStatus.error)),
        serviceStatus?.instance && React.createElement(React.Fragment, null,
          React.createElement('p', null, `服务：${serviceStatus.instance.service_state}　版本：${serviceStatus.instance.tool_version}　实例：${serviceStatus.instance.instance_id}　PID：${serviceStatus.instance.pid}`),
          React.createElement('p', null, `设备效果：${serviceStatus.instance.control_effect.state}（${text(serviceStatus.instance.control_effect.reason_code)}）；活动试验：${serviceStatus.instance.activity.trial_active ? '是' : '否'}；未决试验：${serviceStatus.instance.activity.trial_unresolved ? '是' : '否'}`),
          serviceStatus.instance.sessions.map(item => React.createElement('p', { key: item.session_id }, `${item.session_id}：连接 ${item.connected ? '是' : '否'} / 心跳 ${item.heartbeat_active ? '活动' : '未活动'} / 记录 ${item.recording_active ? '活动' : '未活动'}`))),
        React.createElement('label', { style: { display: 'block' } }, React.createElement('input', { type: 'checkbox', checked: shutdownConfirmed, disabled: busy, onChange: (event: React.ChangeEvent<HTMLInputElement>) => setShutdownConfirmed(event.target.checked) }), '我确认仅退出当前服务；不会发送设备 Stop，活动心跳、试验和未决效果需人工判断。'),
        React.createElement('button', { style: styles.button, disabled: busy || !serviceStatus?.attached || !shutdownConfirmed, onClick: () => manageService('shutdown') }, '确认退出服务'),
      )
}
