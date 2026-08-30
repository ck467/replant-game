// All game balance lives here — tune numbers, refresh the page.
const CONFIG = {
  // Puzzle board
  BOARD_COLS: 3,
  BOARD_ROWS: 3,
  // Chance (out of 100) that the crate drops a stage 1 / 2 / 3 / 4 item.
  SPAWN_WEIGHTS: [70, 15, 10, 5],
  CHAIN_LENGTH: 5,

  // World map
  MAP_COLS: 12,
  MAP_ROWS: 8,
  SPREAD_INTERVAL_MS: 45000, // deforestation claims one green patch this often
  RESTORE_GOAL_PCT: 75,      // green % that counts as "balance restored"

  // Timed run: the goal is GOAL_TREES full trees, but the clock always runs
  // its full TIME_MS — players who beat the goal keep planting past it.
  CHALLENGE: {
    GOAL_TREES: 7,
    TIME_MS: 120000
  },

  // Anonymous accounts pick one of the crop-sheet portrait tiles as avatar
  AVATAR_COUNT: 20,

  // The exhibition research: what deforestation causes…
  IMPACTS: [
    'more carbon dioxide is released into the air',
    'greenhouse gas emissions grow',
    "the world's biodiversity is threatened",
    'animals lose their habitat and face extinction',
    'soil erosion and flooding get worse',
    'droughts become more common',
    'global warming speeds up',
    'less oxygen is left for every living thing'
  ],
  // …and what each of us can do about it
  SOLUTIONS: [
    'Buy FSC-certified wood and paper products',
    'Plant one tree every year',
    'Eat less beef',
    'Reuse paper instead of throwing it away',
    'Replant trees wherever they are cut down',
    'Support indigenous land rights'
  ],

  STAGE_NAMES: ['Seed', 'Sprout', 'Sapling', 'Young Tree', 'Mature Tree'],

  // Puzzle item art: "Farming crops 16x16" by josehzz (OpenGameArt, CC0).
  // The sheet is a 12x10 grid of 16px tiles; `tiles` lists [col,row] for
  // stages 1 (seed) through 5 (mature tree).
  CROP_SHEET: { cols: 12, rows: 10 },
  SPECIES: [
    {
      id: 'lemon',
      name: 'Lemon',
      tiles: [[11, 3], [10, 3], [9, 3], [8, 3], [7, 3]],
      fact: 'A healthy lemon tree can keep giving fruit for over 50 years — hundreds of lemons every single year.'
    },
    {
      id: 'coffee',
      name: 'Coffee',
      tiles: [[11, 7], [10, 7], [9, 7], [8, 7], [7, 7]],
      fact: 'Coffee grows best in the shade of taller trees — shade-grown coffee farms help keep rainforests standing.'
    },
    {
      id: 'orange',
      name: 'Orange',
      tiles: [[5, 8], [4, 8], [3, 8], [2, 8], [1, 8]],
      fact: 'Orange trees are evergreen — they keep their leaves all year round and can bear fruit for more than 80 years.'
    },
    {
      id: 'avocado',
      name: 'Avocado',
      tiles: [[11, 8], [10, 8], [9, 8], [8, 8], [7, 8]],
      fact: 'An avocado tree can grow 20 metres tall, and its deep roots help hold soil and rainwater in place.'
    }
  ]
};
