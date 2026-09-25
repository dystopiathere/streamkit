-- Kick: площадка аналитики, событий и чата. Значение энума площадок уже было
-- заведено под VKPLAY и TROVO, Kick встаёт рядом с ними.
ALTER TYPE "Platform" ADD VALUE 'KICK';

-- Источник событий — перед WEBHOOK, в том же порядке, что в schema.prisma.
ALTER TYPE "EventProvider" ADD VALUE 'KICK' BEFORE 'WEBHOOK';
