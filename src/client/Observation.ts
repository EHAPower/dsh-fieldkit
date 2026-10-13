import React, { useEffect, useRef, useState } from 'react'
import * as echarts from 'echarts/core'
import { LineChart } from 'echarts/charts'
import { GridComponent, TooltipComponent, LegendComponent, DataZoomComponent, AriaComponent } from 'echarts/components'
import { CanvasRenderer } from 'echarts/renderers'
import { appendEvents, chartSeries } from './event-history.js'
import { panelStyles, errorText, valueOf } from './shared.js'
echarts.use([LineChart, GridComponent, TooltipComponent, LegendComponent, DataZoomComponent, AriaComponent, CanvasRenderer])
export function Observation({ remote, sessionId, binding, enabled, visible, onGap }: any) {
  const [paused, setPaused] = useState(false), [history, setHistory] = useState<any[]>([]), [notice, setNotice] = useState('等待事件。'), [tick, setTick] = useState(0)
  const [received, setReceived] = useState(0), [gapCount, setGapCount] = useState(0)
  const pendingGap = useRef(false)
  const all = useRef<any[]>([]), cursor = useRef('0'), root = useRef<HTMLDivElement>(null), chart = useRef<any>(null), pause = useRef(false), gapCallback = useRef(onGap), styles = panelStyles()
  gapCallback.current = onGap; pause.current = paused
  useEffect(() => { all.current = []; cursor.current = '0'; pendingGap.current = false; setHistory([]); setReceived(0); setGapCount(0) }, [binding?.bindingId])
  useEffect(() => {
    if (!root.current) return
    const instance = echarts.init(root.current); chart.current = instance
    const observer = new ResizeObserver(() => instance.resize()); observer.observe(root.current)
    return () => { observer.disconnect(); instance.dispose(); chart.current = null }
  }, [])
  useEffect(() => {
    chart.current?.setOption({ animation: false, aria: { enabled: true }, legend: { data: ['位置 mm', '速度 mm/s', '力 N'] }, tooltip: { trigger: 'axis', renderMode: 'richText' }, grid: [{ top: 45, height: '22%' }, { top: '39%', height: '22%' }, { top: '70%', height: '22%' }], xAxis: [0, 1, 2].map(gridIndex => ({ type: 'value', gridIndex, name: gridIndex === 2 ? '设备来源相对秒' : '' })), yAxis: [0, 1, 2].map(gridIndex => ({ type: 'value', gridIndex, scale: true })), series: ['position', 'velocity', 'force'].map((channel, i) => ({ name: ['位置 mm', '速度 mm/s', '力 N'][i], type: 'line', xAxisIndex: i, yAxisIndex: i, showSymbol: false, connectNulls: false, smooth: false, data: chartSeries(history, channel) })) }, true)
  }, [history])
  useEffect(() => {
    if (!enabled || !visible || !binding || binding.expired || !sessionId) return
    let active = true, timer: ReturnType<typeof setTimeout>
    const poll = async () => {
      try {
        const batch = valueOf(await remote.getEvents(sessionId, cursor.current))
        if (!active) return
        cursor.current = batch.cursor; all.current = appendEvents(all.current, batch, binding)
        setReceived(v => v + batch.events.length)
        if (batch.gap) { pendingGap.current = true; setGapCount(v => v + 1); setNotice(`事件缺口：${batch.gapReasons.join('、')}；等待缓存补齐。服务遗漏 ${batch.lostRanges.map((r: any) => r.count).join(' / ') || '未知'}，不推断设备掉样。`); }
        if (pendingGap.current && await gapCallback.current() === true) { pendingGap.current = false; if (active) setNotice(previous => previous.replace('等待缓存补齐。', '缓存已补齐。')) }
        if (!pause.current && active) setHistory([...all.current])
      } catch (e) { if (active) setNotice(`事件读取失败：${errorText(e)}；不会重连或重放动作。`) }
      if (active) timer = setTimeout(poll, 250)
    }
    void poll(); const age = setInterval(() => setTick(v => v + 1), 1000)
    return () => { active = false; clearTimeout(timer); clearInterval(age) }
  }, [enabled, visible, sessionId, binding?.bindingId, binding?.expired])
  const latest = [...history].reverse().find(p => p.event)
  const age = latest ? Math.max(0, Date.now() - Number(latest.event.receivedAt)) : null
  return React.createElement('section', { style: styles.card }, React.createElement('h2', null, '来源遥测'),
    React.createElement('p', { role: 'status' }, !enabled ? '服务未发布 events 能力。' : notice),
    React.createElement('button', { onClick: () => { if (paused) setHistory([...all.current]); setPaused(!paused) }, disabled: !enabled || !binding || binding.expired }, paused ? '恢复绘制' : '暂停绘制'),
    React.createElement('p', null, `${binding?.expired ? '观察已暂停：绑定已过期，所示为历史数据。' : !binding ? '未选择目标，观察已暂停。' : !visible ? '页面已隐藏，所示为历史数据。' : !enabled ? '事件能力不可用，所示为历史数据。' : paused ? '绘制暂停；事件消费继续。' : '绘制中。'} 已消费 ${received} 个事件，缺口 ${gapCount} 次；隐藏页停止前端轮询，服务继续采集。`),
    React.createElement('p', null, latest ? `来源：${latest.event.sourceId} · device_monotonic_us ${latest.event.sourceTimestamp.value} · 接收年龄约 ${age} ms（桌面 / 服务时钟差可能影响）` : '尚无当前身份、代次的遥测。'),
    React.createElement('div', { ref: root, style: { width: '100%', height: 440 }, role: 'img', 'aria-label': '位置、速度和力随设备来源时间变化；无效或缺失数据断线' }),
    latest && React.createElement('details', null, React.createElement('summary', null, '最新原始数据与质量'), React.createElement('pre', { style: styles.mono }, latest.event.nativeJsonText)),
    React.createElement('p', null, '仅 result=1、quality=1 且非 stale 的有限值绘图；未知质量、缺口均断线，不插值。数值仅作显示，原文保持不变。'))
}
