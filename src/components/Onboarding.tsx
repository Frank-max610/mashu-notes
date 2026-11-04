import { useState } from 'react';
import { MochiNode } from './MochiNode';
import { Icon } from './Icon';
import './Onboarding.css';

export interface OnboardingProps {
  onDone: (openGraph: boolean) => void;
}

const STEPS = [
  {
    id: 'graph',
    eyebrow: '生活图谱',
    title: '看见生活的形状',
    body: '每个小球是一个生活目录，比如身体健康、工作、学习、理财。点开小球才能编辑里面的内容；整个网络，代表你。',
    graph: true,
  },
  {
    id: 'capture',
    eyebrow: '一句话记录',
    title: '想到什么，记一句',
    body: '吃了什么、睡了多久、花了多少，写一句话就好。麻薯会自动归类，不用填表。',
    graph: false,
  },
  {
    id: 'directory',
    eyebrow: '自己的目录',
    title: '目录由你决定',
    body: '工作、阅读、旅行，想建几个就建几个。它们是你的知识库，也是图谱的分支。',
    graph: false,
  },
  {
    id: 'assistant',
    eyebrow: '有依据的助手',
    title: '只依据你的记录回答',
    body: '每天汇总昨天，给出具体建议；回答会标出来源，找不到就直说，不编造。',
    graph: false,
  },
] as const;

/** First-run feature tour, with the life graph as the opening promise. */
export function Onboarding({ onDone }: OnboardingProps) {
  const [index, setIndex] = useState(0);
  const step = STEPS[index];
  const last = index === STEPS.length - 1;

  return (
    <div className="onboarding" role="dialog" aria-modal="true" aria-label="欢迎使用麻薯">
      <header className="onboarding-head">
        <div className="onboarding-brand">
          <MochiNode size={24} />
          <span>麻薯</span>
        </div>
        <button type="button" className="onboarding-skip" onClick={() => onDone(false)}>
          跳过
        </button>
      </header>

      <div className="onboarding-body">
        <p className="onboarding-eyebrow">{step.eyebrow}</p>
        <h1 className="onboarding-title">{step.title}</h1>
        <p className="onboarding-copy">{step.body}</p>

        {step.graph ? (
          <div className="onboarding-graph" aria-hidden="true">
            <svg viewBox="0 0 320 230" className="onboarding-graph-svg">
              <line x1="160" y1="118" x2="84" y2="62" />
              <line x1="160" y1="118" x2="246" y2="76" />
              <line x1="160" y1="118" x2="212" y2="182" />
              <line x1="84" y1="62" x2="58" y2="118" />
              <line x1="84" y1="62" x2="122" y2="32" />
              <line x1="246" y1="76" x2="282" y2="122" />
              <line x1="246" y1="76" x2="214" y2="42" />
              <line x1="212" y1="182" x2="146" y2="196" />
              <line x1="212" y1="182" x2="266" y2="196" />
              <circle className="onboarding-edge-dot" cx="122" cy="32" r="5" />
              <circle className="onboarding-edge-dot" cx="58" cy="118" r="6" />
              <circle className="onboarding-edge-dot" cx="282" cy="122" r="5" />
              <circle className="onboarding-edge-dot" cx="214" cy="42" r="4" />
              <circle className="onboarding-edge-dot" cx="146" cy="196" r="5" />
              <circle className="onboarding-edge-dot" cx="266" cy="196" r="4" />
              <g className="hub hub--work"><circle cx="84" cy="62" r="14" /><text x="84" y="92">工作</text></g>
              <g className="hub hub--life"><circle cx="246" cy="76" r="14" /><text x="246" y="106">生活</text></g>
              <g className="hub hub--read"><circle cx="212" cy="182" r="14" /><text x="212" y="212">阅读</text></g>
              <g className="hub hub--center"><circle cx="160" cy="118" r="17" /><text x="160" y="151">你</text></g>
            </svg>
            <p className="onboarding-graph-caption">一个小球 = 一个目录；整个网络代表你。</p>
          </div>
        ) : (
          <div className={`onboarding-visual onboarding-visual--${step.id}`} aria-hidden="true">
            {step.id === 'capture' ? (
              <>
                <div className="onboarding-capture">
                  <span className="onboarding-capture-plus"><Icon name="plus" size={16} /></span>
                  <span>午饭牛肉面 32 元，620 大卡</span>
                </div>
                <div className="onboarding-parsed">饮食 · 午餐 · ¥32 · 620 千卡</div>
              </>
            ) : null}
            {step.id === 'directory' ? (
              <div className="onboarding-dirs">
                <span className="onboarding-dir" style={{ ['--dir-color' as string]: 'var(--kind-diary)' }}>工作</span>
                <span className="onboarding-dir" style={{ ['--dir-color' as string]: 'var(--kind-health)' }}>生活</span>
                <span className="onboarding-dir" style={{ ['--dir-color' as string]: 'var(--kind-finance)' }}>阅读</span>
                <span className="onboarding-dir onboarding-dir--new">+ 新目录</span>
              </div>
            ) : null}
            {step.id === 'assistant' ? (
              <div className="onboarding-answer">
                <p>根据你的知识库，找到 2 条关于睡眠的记录：</p>
                <p className="onboarding-quote">《睡眠 7.2 小时》 · 11月3日</p>
                <p className="onboarding-quote">《睡眠 6.4 小时》 · 11月2日</p>
                <span className="onboarding-source">来源：《睡眠 7.2 小时》《睡眠 6.4 小时》</span>
              </div>
            ) : null}
          </div>
        )}
      </div>

      <footer className="onboarding-foot">
        <div className="onboarding-dots" aria-hidden="true">
          {STEPS.map((item, dotIndex) => (
            <span key={item.id} className={dotIndex === index ? 'is-active' : ''} />
          ))}
        </div>
        <div className="onboarding-actions">
          {index > 0 ? (
            <button type="button" className="btn btn-ghost" onClick={() => setIndex(index - 1)}>
              上一步
            </button>
          ) : (
            <button type="button" className="btn btn-ghost" onClick={() => onDone(true)}>
              直接看图谱
            </button>
          )}
          <button
            type="button"
            className="btn btn-primary"
            onClick={() => (last ? onDone(false) : setIndex(index + 1))}
          >
            {last ? '开始记录' : '下一步'}
          </button>
        </div>
      </footer>
    </div>
  );
}
