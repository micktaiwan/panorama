#!/usr/bin/env bash
cd /home/davidfm/www/3_boulot/panoramix/panorama || exit 1
exec /home/davidfm/.meteor/meteor run --settings settings.json
