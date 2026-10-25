import { useState } from 'react';
import { useStore } from '../store.js';
import { AugmentEmblem, KindTag, CostBadge, RequiresTag } from '../components/augmentBits.jsx';

function AugmentCard({ aug }) {
  return (
    <div className={`augment-card-upright kind-${augmentKind(aug)}`} data-aug-id={aug.id} onClick={() => showAugmentDetail(aug)}>
      <div className="ac-header">
        <AugmentEmblem aug={aug} />
        <div className="ac-titles">
          <div className="ac-name">{aug.name}</div>
          <div className="ac-meta"><KindTag aug={aug} /><CostBadge cost={aug.cost} /></div>
        </div>
      </div>
      <div className="ac-desc">{aug.desc}</div>
      {aug.requires && <div className="ac-footer"><RequiresTag aug={aug} /></div>}
    </div>
  );
}

export default function AugmentsPage() {
  useStore(); // re-render once descriptions load (they're filled into AUGMENTS in place)
  const [filter, setFilter] = useState('all');
  const kinds = filter === 'all' ? AUGMENT_KIND_ORDER : [filter];

  return (
    <main className="augments-main">
      <div className="page-head">
        <h1>Augments</h1>
        <p>Every power you can draft, and what it does to the board.</p>
      </div>
      <div className="filter-bar">
        {['all', ...AUGMENT_KIND_ORDER].map(kind => (
          <button
            key={kind}
            type="button"
            className={'filter-chip' + (kind === 'all' ? '' : ` kind-${kind}`) + (filter === kind ? ' active' : '')}
            onClick={() => setFilter(kind)}
          >
            {kind === 'all' ? 'All' : AUGMENT_KIND_NAMES[kind]}{' '}
            <span className="chip-count">{kind === 'all' ? AUGMENTS.length : AUGMENTS.filter(a => augmentKind(a) === kind).length}</span>
          </button>
        ))}
      </div>
      <div>
        {kinds.map(kind => {
          const augs = AUGMENTS.filter(a => augmentKind(a) === kind).sort((a, b) => a.cost - b.cost);
          if (!augs.length) return null;
          return (
            <div key={kind} className={`augments-by-cost kind-${kind}`}>
              <h2>{AUGMENT_KIND_NAMES[kind]}</h2>
              <div className="augment-cards">{augs.map(aug => <AugmentCard key={aug.id} aug={aug} />)}</div>
            </div>
          );
        })}
      </div>
    </main>
  );
}
