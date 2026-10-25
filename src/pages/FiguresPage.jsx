// Figure artwork: the white-side render where one exists, else the emblem
// (figureArtUrl in views.js picks which).
function FigureArt({ fig }) {
  if (!fig.image) return <img className="emblem" src={figureIconUrl(fig.id)} alt={fig.name} draggable={false} />;
  // Ghoul art is a single grey set — lift it like a White piece on the board.
  return <img src={figureArtUrl(fig)} alt={fig.name} className={fig.id === 'ghoul' ? 'figure-ghoul-art' : undefined} />;
}

export default function FiguresPage() {
  return (
    <main className="augments-main">
      <div className="page-head">
        <h1>Figures</h1>
        <p>Alternative units that replace standard pieces through Unit Exchange augments.</p>
      </div>
      <div>
        {FIGURE_TYPE_ORDER.map(type => {
          const figures = FIGURES.filter(f => f.replaces === type);
          if (!figures.length) return null;
          return (
            <div key={type} className="augments-by-cost">
              <h2>{FIGURE_TYPE_NAMES[type]} Figures</h2>
              <div className="augment-cards">
                {figures.map(fig => (
                  <div key={fig.id} className="augment-card-upright figure-card" data-id={fig.id} onClick={() => showFigureDetail(fig)}>
                    <div className="figure-art"><FigureArt fig={fig} /></div>
                    <div className="ac-header">
                      <div className="ac-titles">
                        <div className="ac-name">{fig.name}</div>
                        <div className="ac-meta">
                          <span className="kind-tag kind-unit">Replaces {FIGURE_TYPE_NAMES[fig.replaces]}</span>
                          {!fig.image && <span className="pending-tag">Art pending</span>}
                        </div>
                      </div>
                    </div>
                    <div className="ac-desc">{fig.desc}</div>
                  </div>
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </main>
  );
}
