// React versions of views.js's emblem/tag/badge builders.

export function Emblem({ src, alt = '', style }) {
  return <img className="emblem" src={src} alt={alt} draggable={false} style={style} />;
}

export function AugmentEmblem({ aug, style }) {
  return <Emblem src={augmentIconUrl(aug.id)} alt={aug.name} style={style} />;
}

export function KindTag({ aug }) {
  const kind = augmentKind(aug);
  return <span className={`kind-tag kind-${kind}`}>{AUGMENT_KIND_NAMES[kind]}</span>;
}

export function CostBadge({ cost }) {
  return <span className="cost-badge"><span className="cost-num">{cost}</span>{cost === 1 ? 'point' : 'points'}</span>;
}

export function RequiresTag({ aug }) {
  const parent = AUGMENTS.find(a => a.id === aug.requires);
  return <span className="requires-tag">Requires <strong>{parent ? parent.name : aug.requires}</strong></span>;
}
