import mongoose from 'mongoose';

const teamSchema = new mongoose.Schema({ name: String, logo: String }, { _id: false });

const streamServerSchema = new mongoose.Schema(
  {
    id: String,
    label: String,
    // hls | dash | mp4 play in our own player; embed is a third-party page we can't unwrap;
    // link is a page that refuses to be embedded, so it opens in its own tab.
    type: { type: String, enum: ['hls', 'dash', 'mp4', 'embed', 'link'] },
    url: String,
    adFree: Boolean,
    // false when the stream refuses other origins: it only works in VLC, mpv, etc.
    browserPlayable: Boolean,
  },
  { _id: false },
);

const matchSchema = new mongoose.Schema(
  {
    // Stable identity across refreshes: hash of date + teams.
    key: { type: String, required: true, unique: true },
    // Where the match came from. Documents saved before there were two sources have no value: fast-shot.
    source: { type: String, enum: ['fastshot', 'yacine'], default: 'fastshot' },
    date: { type: String, required: true, index: true }, // YYYY-MM-DD, source timezone
    home: teamSchema,
    away: teamSchema,
    time: String, // HH:mm as published (source timezone)
    startsAt: Date,
    status: { type: String, enum: ['live', 'finished', 'upcoming'], required: true, index: true },
    score: { home: Number, away: Number },
    channel: String,
    commentator: String,
    region: String,
    competition: String,
    sourceUrl: String, // player page or match page the card links to
    sourceType: { type: String, enum: ['player', 'page'], required: true },
    streams: {
      servers: [streamServerSchema],
      reason: String,
      resolvedAt: Date,
    },
    // Old matches are removed automatically by a TTL index.
    expireAt: { type: Date, index: { expires: 0 } },
  },
  { timestamps: true },
);

export const Match = mongoose.model('Match', matchSchema);
