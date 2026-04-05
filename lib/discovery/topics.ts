// Static topic configuration for the proactive content discovery subsystem.

export interface DiscoveryTopic {
  /** Unique machine-readable ID. Used as the discoveryTopic label on articles. */
  id: string;
  /** Human-readable label for logging. */
  label: string;
  /**
   * Search query strings for this topic. The discovery orchestrator uses
   * searchQueries[0] as the primary query. Additional entries are reserved
   * for future multi-query rotation.
   */
  searchQueries: string[];
  /**
   * Default soft weight (0.1-2.0). Equal for all topics at initialization.
   * Per-identity overrides are stored in the discovery_topic_weights DB table.
   */
  defaultWeight: number;
}

export const DISCOVERY_TOPICS: DiscoveryTopic[] = [
  {
    id: 'fringe-science',
    label: 'Fringe & Emerging Science',
    searchQueries: ['emerging research fringe science discoveries'],
    defaultWeight: 1.0,
  },
  {
    id: 'music-audio-culture',
    label: 'Music & Audio Culture',
    searchQueries: ['underground music scene audio culture experimental sound'],
    defaultWeight: 1.0,
  },
  {
    id: 'visual-art-design',
    label: 'Visual Art & Design',
    searchQueries: ['contemporary visual art illustration design culture'],
    defaultWeight: 1.0,
  },
  {
    id: 'architecture',
    label: 'Architecture & Built Environment',
    searchQueries: ['architecture built environment urban design innovation'],
    defaultWeight: 1.0,
  },
  {
    id: 'fashion-material-culture',
    label: 'Fashion & Material Culture',
    searchQueries: ['fashion textiles material culture craft design'],
    defaultWeight: 1.0,
  },
  {
    id: 'nature-ecology',
    label: 'Nature & Ecology',
    searchQueries: ['ecology wildlife biology nature conservation research'],
    defaultWeight: 1.0,
  },
  {
    id: 'math-philosophy',
    label: 'Mathematics & Philosophy',
    searchQueries: ['mathematics logic philosophy ideas research'],
    defaultWeight: 1.0,
  },
  {
    id: 'film-visual-storytelling',
    label: 'Film & Visual Storytelling',
    searchQueries: ['film cinema photography visual storytelling culture'],
    defaultWeight: 1.0,
  },
  {
    id: 'literature-language',
    label: 'Literature & Language',
    searchQueries: ['literature writing language culture essays books'],
    defaultWeight: 1.0,
  },
  {
    id: 'craft-making',
    label: 'Craft & Making',
    searchQueries: ['craft making fabrication handmade artisan techniques'],
    defaultWeight: 1.0,
  },
  {
    id: 'economics-behavioral',
    label: 'Economics & Behavioral Science',
    searchQueries: ['economics behavioral science social dynamics research'],
    defaultWeight: 1.0,
  },
  {
    id: 'history-archaeology',
    label: 'History & Archaeology',
    searchQueries: ['history archaeology discovery ancient culture findings'],
    defaultWeight: 1.0,
  },
];
