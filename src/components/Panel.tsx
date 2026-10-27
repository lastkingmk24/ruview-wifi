import type { ReactNode } from 'react';

interface Props {
  title: string;
  kicker?: string;
  icon?: ReactNode;
  action?: ReactNode;
  className?: string;
  children: ReactNode;
}

export default function Panel({ title, kicker, icon, action, className = '', children }: Props) {
  return (
    <section className={`panel ${className}`}>
      <header className="panel-heading">
        <div className="panel-title-group">
          {icon ? <span className="panel-icon" aria-hidden="true">{icon}</span> : null}
          <div>
            {kicker ? <div className="panel-kicker">{kicker}</div> : null}
            <h2>{title}</h2>
          </div>
        </div>
        {action ? <div className="panel-action">{action}</div> : null}
      </header>
      {children}
    </section>
  );
}
