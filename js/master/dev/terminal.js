// -------------------------------------------------
// --------------- Terminal Emulator ---------------
// -------------------------------------------------

"use strict";

var UTF8 = require('../../lib/utf8');
var message = require('../messagehandler');

var Colors = new Array(
    // standard colors
    "#000000", "#BB0000", "#00BB00", "#BBBB00",
    "#0000BB", "#BB00BB", "#00BBBB", "#BBBBBB",
    // brighter colors
    "#555555", "#FF5555", "#55FF55", "#FFFF55",
    "#5555FF", "#FF55FF", "#55FFFF", "#FFFFFF",
    // dimmed colors
    "#000000", "#770000", "#007700", "#777700",
    "#000077", "#770077", "#007777", "#777777"
);


// constructor
function Terminal(nrows, ncolumns, elemId) {
    this.nrows = nrows;
    this.ncolumns = ncolumns;

    var ele = document.getElementById(elemId);
    if (ele.tagName == "CANVAS") {
        this.canvas = ele;
        this.context = this.canvas.getContext("2d");
        this.context.font = "13px courier,fixed,swiss,monospace,sans-serif";
    } else {
        this.Table = ele;
        this.rowelements = new Array(this.nrows);
        for (var i = 0; i < nrows; i++) {
            var TR = this.Table.insertRow(0);
            var TD = document.createElement("td");
            this.rowelements[i] = TD;
            TR.appendChild(TD);
        }
    }

    this.cursorvisible = false;
    this.escapetype = 0;
    this.escapestring = "";
    this.cursorx = 0;
    this.cursory = 0;
    this.scrolltop = 0;
    this.scrollbottom = this.nrows-1;
    this.currentcolor = 0x7;
    this.pauseblink = false;
    this.OnCharReceived = function (){};

    this.framerequested = false;
    this.timeout = 30; // the time in ms when the next frame is drawn

    this.updaterow = new Uint8Array(this.nrows);

    this.utf8converter = new UTF8.UTF8StreamToUnicode();

    this.screen = new Array(this.nrows);
    this.color = new Array(this.nrows);
    for (var i = 0; i < this.nrows; i++) {
        this.updaterow[i] = 1;
        this.screen[i] = new Uint16Array(this.ncolumns);
        this.color[i]  = new Uint16Array(this.ncolumns);

        for (var j = 0; j < this.ncolumns; j++) {
            this.screen[i][j] = 0x20;
            this.color[i][j] = this.currentcolor;
        }
    }
    this.UpdateScreen();
    this.Blink();
}

// Stop blinking cursor when the VM is paused
Terminal.prototype.PauseBlink = function(pause) {
    pause = !! pause;
    this.pauseblink = pause;
    this.cursorvisible = ! pause;
    this.PrepareUpdateRow(this.cursory, this.cursorx);
}

Terminal.prototype.Blink = function() {
    this.cursorvisible = !this.cursorvisible;
    if(!this.pauseblink) this.PrepareUpdateRow(this.cursory, this.cursorx);
    window.setTimeout(this.Blink.bind(this), 500); // update every half second
};

Terminal.prototype.DeleteRow = function(row) {
    for (var j = 0; j < this.ncolumns; j++) {
        this.screen[row][j] = 0x20;
        this.color[row][j] = this.currentcolor;
    }
    this.PrepareUpdateRow(row);
};

Terminal.prototype.DeleteArea = function(row, column, row2, column2) {
    for (var i = row; i <= row2; i++) {
        for (var j = column; j <= column2; j++) {
            this.screen[i][j] = 0x20;
            this.color[i][j] = this.currentcolor;
        }
        this.PrepareUpdateRow(i);
    }
};


Terminal.prototype.UpdateRowCanvas = function(row) {
    var y = row << 4;
    var line = this.screen[row];
    var c = this.color[row][0]|0;
    var n = 0;

    for (var column = 0; column < this.ncolumns; column++) {

        var cnew = this.color[row][column]|0;

        if (this.cursorvisible)
        if (row == this.cursory)
        if (column == this.cursorx) {
            cnew |= 0x600;
        }

        if (c != cnew) {
            var x = (column - n) << 3;
            this.context.fillStyle = Colors[(c >>> 8) & 0x1F]; 
            this.context.fillRect(x, y, n*8, 16);
            this.context.fillStyle = Colors[c & 0x1F];
            for(var i=0; i<n; i++) {
                this.context.fillText(String.fromCharCode(line[column - n + i]), x+(i<<3), y+12);
            }
            c = cnew;
            n = 0;
        }

        n++;
    }

    var x = (column - n) << 3;
    this.context.fillStyle = Colors[(c >>> 8) & 0x1F]; 
    this.context.fillRect(x, y, n*8, 16);
    this.context.fillStyle = Colors[c & 0x1F];
    for(var i=0; i<n; i++) {
        this.context.fillText(String.fromCharCode(line[column - n + i]), x+(i<<3), y+12);
    }

};

Terminal.prototype.GetSpan = function(c, line, idx, n) {
    var html = "<span style=\"color:" + Colors[c & 0x1F] + ";background-color:" + Colors[(c >> 8) & 0x1F] + "\">";
    for(var i=0; i<n; i++) {
        switch (line[idx + i])
        {
        case 0x20:
            html += "&nbsp;"; 
            break;

        case 0x26: // '&'
            html += "&amp;"; 
            break;

        case 0x3C: // '<'
            html += "&lt;"; 
            break;

        case 0x3E: // '>'
            html += "&gt;"; 
            break;

        default:        
            html += String.fromCharCode(line[idx + i]);
            break;
        }
    }
    html += "</span>";
    return html;
}


Terminal.prototype.UpdateRowTable = function(row) {
    var y = row << 4;
    var line = this.screen[row];
    var c = this.color[row][0]|0;
    var n = 0;
    var html = "";

    for (var column = 0; column < this.ncolumns; column++) {

        var cnew = this.color[row][column]|0;

        if (this.cursorvisible)
        if (row == this.cursory)
        if (column == this.cursorx) {
            cnew |= 0x600;
        }

        if (c != cnew) {
            html += this.GetSpan(c, line, column - n, n);
            c = cnew;
            n = 0;
        }
        n++;
    }
    html += this.GetSpan(c, line, column - n, n);
    this.rowelements[this.nrows - row - 1].innerHTML = html;

};

Terminal.prototype.UpdateScreen = function() {
    var nupdated = 0;
    for (var i = 0; i < this.nrows; i++) {
        if (!this.updaterow[i]) continue;
        if (this.canvas) {
            this.UpdateRowCanvas(i);
        } else {
            this.UpdateRowTable(i);
        }
        nupdated++;
        this.updaterow[i] = 0;
    }
    this.framerequested = false;
    if (nupdated >= (this.nrows-1)) {
        this.timeout = 100;
    } else {
        this.timeout = 30;
    }
}

Terminal.prototype.PrepareUpdateRow = function(row) {
    this.updaterow[row] = 1;
    if (this.framerequested) return;
    if (this.timeout <= 30) {
        window.requestAnimationFrame(this.UpdateScreen.bind(this));
    } else {
        window.setTimeout(this.UpdateScreen.bind(this), this.timeout);
    }
    this.framerequested = true;
}

Terminal.prototype.ScrollDown = function(draw) {
    var tempscreen = this.screen[this.scrollbottom];
    var tempcolor = this.color[this.scrollbottom];

    for (var i = this.scrollbottom-1; i >= this.scrolltop; i--) {
        if (i == this.nrows-1) continue;
        this.screen[i + 1] = this.screen[i];
        this.color[i + 1] = this.color[i];
        if (draw) this.PrepareUpdateRow(i+1);
    }
    this.screen[this.scrolltop] = tempscreen;
    this.color[this.scrolltop] = tempcolor;
    this.DeleteRow(this.scrolltop);
    if (draw) this.PrepareUpdateRow(this.scrolltop);
}

Terminal.prototype.ScrollUp = function(draw) {
    var tempscreen = this.screen[this.scrolltop];
    var tempcolor = this.color[this.scrolltop];

    for (var i = this.scrolltop+1; i <= this.scrollbottom; i++) {
        if (i == 0) continue;
        this.screen[i - 1] = this.screen[i];
        this.color[i - 1] = this.color[i];
        if (draw) this.PrepareUpdateRow(i-1);
    }

    this.screen[this.scrollbottom] = tempscreen;
    this.color[this.scrollbottom] = tempcolor;
    this.DeleteRow(this.scrollbottom);
    if (draw) this.PrepareUpdateRow(this.scrollbottom);
};

Terminal.prototype.LineFeed = function() {
    if (this.cursory != this.scrollbottom) {
        this.cursory++;
        if (this.cursorvisible) {
            this.PrepareUpdateRow(this.cursory-1); // delete old cursor position
            this.PrepareUpdateRow(this.cursory); // show new cursor position
        }
        return;
    }
    this.ScrollUp(true);
};

Terminal.prototype.ChangeCursor = function(Numbers) {
    switch (Numbers.length) {
    case 0:
        this.cursorx = 0;
        this.cursory = 0;
        break;
    case 1:
        this.cursory = Numbers[0];
        if (this.cursory) this.cursory--;
        break;
    case 2:
    default:
        // TODO check for boundaries
        this.cursory = Numbers[0];
        this.cursorx = Numbers[1];
        if (this.cursorx) this.cursorx--;
        if (this.cursory) this.cursory--;
        break;
    }
    if (this.cursorx >= this.ncolumns) this.cursorx = this.ncolumns - 1;
    if (this.cursory >= this.nrows) this.cursory = this.nrows - 1;
};

Terminal.prototype.ChangeColor = function(Numbers) {

    if (Numbers.length == 0) { // reset;
         this.currentcolor = 0x7;
         return;
    }

    var c = this.currentcolor;

    for (var i = 0; i < Numbers.length; i++) {
        switch (Number(Numbers[i])) {
        case 30: case 31: case 32: case 33: case 34: case 35: case 36: case 37:
            c = c & (0xFFF8) | (Numbers[i] - 30) & 0x7;
            break;
        case 40: case 41: case 42: case 43: case 44: case 45: case 46: case 47:
            c = c & (0x00FF) | (((Numbers[i] - 40) & 0x7) << 8);
            break;
        case 0:
            c = 0x7; // reset
            break;
        case 1: // brighter foreground color
            c = c | 0x8;
            break;
        case 2: // dimmed foreground color
            c = c | 0x10;
            break;
        case 4: // underline ignored
            break;
        case 5: // extended colors or blink ignored
             //i++;
             break;
        case 7: // inverted
            c = ((c & 0x7) << 8) | ((c >> 8)) & 0x7; 
            break;
        case 8: // hidden ignored
            break;
        case 39:
            c = c & (0xFF00) | 0x7; // set standard foreground color
            break;
        case 49:
            c = c & 0x00FF; // set standard background color
            break;
        case 10:
            // reset mapping ?
            break;
        default:
            message.Debug("Color " + Numbers[i] + " not found");
            break;
        }
    }
    this.currentcolor = c|0;

};

Terminal.prototype.HandleEscapeSequence = function() {
    //message.Debug("Escape sequence:'" + this.escapestring+"'");
    var i = 0;
    if (this.escapestring == "[J") {
        this.DeleteArea(this.cursory, this.cursorx, this.cursory, this.ncolumns - 1);
        this.DeleteArea(this.cursory + 1, 0., this.nrows - 1, this.ncolumns - 1);
        return;
    } else
    if (this.escapestring == "M") {
        this.ScrollDown(true);
        return;
    }
    // Testing for [x;y;z
    var s = this.escapestring;

    if (s.charAt(0) != "[") {
        message.Debug("Escape sequence unknown:'" + this.escapestring + "'");
        return; // the short escape sequences must be handled earlier
    }

    s = s.substr(1); // delete first sign
    var lastsign = s.substr(s.length - 1); // extract command
    s = s.substr(0, s.length - 1); // remove command
    var numbers = s.split(";"); // if there are multiple numbers, split them
    if (numbers[0].length == 0) {
        numbers = [];
    }
    // the array must contain of numbers and not strings. Make this sure
    if (s.charAt(0) != '?') {
        for (i=0; i<numbers.length; i++) {
            numbers[i] = Number(numbers[i]);
        }
    }

    var oldcursory = this.cursory; // save current cursor position
    var count = 0;
    switch(lastsign) {

        case 'l':
            if (this.escapestring)
            for(var i=0; i<numbers.length; i++) {
                switch(numbers[i]) {
                    case '7': // disable line wrap
                    break;
                    case '?25': // disable cursor
                    break;
                    case '?7': // reset auto-wrap mode 
                    break;
                    default:
                        message.Debug("Term Parameter " + this.escapestring + " unknown");
                    break;
                }
            }
            break;

        case 'h':
            for(var i=0; i<numbers.length; i++) {
                switch(numbers[i]) {
                    case '7': // enable line wrap
                    break;
                    case '?25': // enable cursor
                    break;
                    case '?7': // Set auto-wrap mode 
                    break;
                    default:
                        message.Debug("Term Parameter " + this.escapestring + " unknown");
                    break;
                }
            }
            break;

        case 'c':
            for(var i=0; i<numbers.length; i++) {
                switch(numbers[i]) {
                    default:
                        message.Debug("Term Parameter " + this.escapestring + " unknown");
                    break;
                }
            }
            break;

        case 'm': // colors
            this.ChangeColor(numbers);
            return;

        case 'A': // move cursor up
            count = numbers.length ? numbers[0] : 1;
            if (count == 0) count = 1;
            this.cursory -= count;
            break;

        case 'B': // move cursor down
            count = numbers.length ? numbers[0] : 1;
            if (count == 0) count = 1;
            this.cursory += count;
            break;

        case 'C': // move cursor right
            count = numbers.length ? numbers[0] : 1;
            if (count == 0) count = 1;
            this.cursorx += count;
            break;

        case 'D': // move cursor left
            count = numbers.length ? numbers[0] : 1;
            if (count == 0) count = 1;
            this.cursorx -= count;
            if (this.cursorx < 0) this.cursorx = 0;
            break;

        case 'E': // move cursor down
            count = numbers.length ? numbers[0] : 1;
            this.cursory += count;
            this.cursorx = 0;
            break;

        case 'F': // move cursor up
            count = numbers.length ? numbers[0] : 1;
            this.cursory -= count;
            if (this.cursory < 0) this.cursory = 0;
            this.cursorx = 0;
            break;

        case 'G': // change cursor column
            count = numbers.length ? numbers[0] : 1;
            this.cursorx = count;
            if (this.cursorx) this.cursorx--;
            break;

        case 'H': // cursor position
        case 'd':
        case 'f':
            this.ChangeCursor(numbers);
            break;

        case 'K': // erase
            count = numbers.length ? numbers[0] : 1;
            if (!numbers.length) {
                this.DeleteArea(this.cursory, this.cursorx, this.cursory, this.ncolumns - 1);
            } else 
            if (numbers[0] == 1) {
                this.DeleteArea(this.cursory, 0., this.cursory, this.cursorx);
            } else
            if (numbers[0] == 2) {
                this.DeleteRow(this.cursory);
            }
            break;

        case 'L': // scroll down
            count = numbers.length ? numbers[0] : 1;
            if (count == 0) count = 1;
            var top = this.scrolltop;
            this.scrolltop = this.cursory;
            if (count == 1) {
                this.ScrollDown(true);
            } else {
                for (var j = 0; j < count-1; j++) {
                    this.ScrollDown(false);
                }
                this.ScrollDown(true);
            }
            this.scrolltop = top;
            break;

        case 'M': // scroll up
            count = numbers.length ? numbers[0] : 1;
            if (count == 0) count = 1;
            var top = this.scrolltop;
            this.scrolltop = this.cursory;
            if (count == 1) {
                this.ScrollUp(true);
            } else {
                for (var j = 0; j < count-1; j++) {
                    this.ScrollUp(false);
                }
                this.ScrollUp(true);
            }
            this.scrolltop = top;
            break;

        case 'P': /* shift left from cursor and fill with zero */
            count = numbers.length ? numbers[0] : 1;
            if (count == 0) count = 1;
            var n = 0;n
            for (var j = this.cursorx+count; j < this.ncolumns; j++) {
                this.screen[this.cursory][this.cursorx+n] = this.screen[this.cursory][j];
                this.color[this.cursory][this.cursorx+n] = this.color[this.cursory][j];
                n++;
            }
            this.DeleteArea(this.cursory, this.ncolumns-count, this.cursory, this.ncolumns-1);
            this.PrepareUpdateRow(this.cursory);
            break;

        case 'r': // set scrolling region
            if (numbers.length == 0) {
                this.scrolltop = 0;
                this.scrollbottom = this.nrows-1;
            } else {
                this.scrolltop = numbers[0];
                this.scrollbottom = numbers[1];
                if (this.scrolltop) this.scrolltop--;
                if (this.scrollbottom) this.scrollbottom--;
            }
            return;

        case 'X': // erase only number of characters in current line    
            count = numbers.length ? numbers[0] : 1;
            if (count == 0) count = 1;
            for (var j = 0; j < count; j++) {
                this.screen[this.cursory][this.cursorx+j] = 0x20;
                this.color[this.cursory][this.cursorx+j] = this.currentcolor;
            }
            this.PrepareUpdateRow(this.cursory);
            break;    

        default:
            message.Debug("Escape sequence unknown:'" + this.escapestring + "'");
        break;
    }

     if (this.cursorvisible) {
        this.PrepareUpdateRow(this.cursory);
        if (this.cursory != oldcursory) {
            this.PrepareUpdateRow(oldcursory);
        }
    }
};



Terminal.prototype.PutChar = function(c) {
    var i = 0;
    //message.Debug("Char:" + c + " " +  String.fromCharCode(c));
    // escape sequence (CS)
    if (this.escapetype == 2) {
        this.escapestring += String.fromCharCode(c);
        if ((c >= 64) && (c <= 126)) {
            this.HandleEscapeSequence();
            this.escapetype = 0;
        }
        return;
    }

    // escape sequence
    if ((this.escapetype == 0) && (c == 0x1B)) {
        this.escapetype = 1;
        this.escapestring = "";
        return;
    }

    // starting escape sequence
    if (this.escapetype == 1) {
        this.escapestring += String.fromCharCode(c);
        // Control Sequence Introducer ([)
        if (c == 0x5B) {
            this.escapetype = 2;
            return;
        }
        this.HandleEscapeSequence();
        this.escapetype = 0;
        return;
    }
    switch (c) {
    case 0xA:
        // line feed
        this.LineFeed();
        this.OnCharReceived("\n");
        return;
    case 0xD:
        // carriage return
        this.cursorx = 0;
        this.PrepareUpdateRow(this.cursory);
        return;
    case 0x7:
        // beep
        return;
    case 0x8:
        // back space
        this.cursorx--;
        if (this.cursorx < 0) {
            this.cursorx = 0;
        }
        this.PrepareUpdateRow(this.cursory);
        return;
    case 0x9:
        // horizontal tab
        var spaces = 8 - (this.cursorx&7);
        do
        {
            if (this.cursorx >= this.ncolumns) {
                this.PrepareUpdateRow(this.cursory);
                this.LineFeed();
                this.cursorx = 0;
            }
            this.screen[this.cursory][this.cursorx] = 32;
            this.color[this.cursory][this.cursorx] = this.currentcolor;	
            this.cursorx++;
        } while(spaces--);
        this.PrepareUpdateRow(this.cursory);
        return;

    case 0x00:  case 0x01:  case 0x02:  case 0x03:
    case 0x04:  case 0x05:  case 0x06:  case 0x0B:
    case 0x0C:  case 0x0E:  case 0x0F:
    case 0x10:  case 0x11:  case 0x12:  case 0x13:
    case 0x14:  case 0x15:  case 0x16:  case 0x17:
    case 0x18:  case 0x19:  case 0x1A:  case 0x1B:
    case 0x1C:  case 0x1D:  case 0x1E:  case 0x1F:
        message.Debug("unknown character " + c);
        return;
    }

    if (this.cursorx >= this.ncolumns) {
        this.LineFeed();
        this.cursorx = 0;
    }

    c = this.utf8converter.Put(c);
    if (c == -1) return;
    var cx = this.cursorx;
    var cy = this.cursory;
    this.screen[cy][cx] = c;

    this.color[cy][cx] = this.currentcolor;
    this.cursorx++;
    //message.Debug("Write: " + String.fromCharCode(c));
    this.PrepareUpdateRow(cy);

    this.OnCharReceived(String.fromCharCode(c));
};

module.exports = Terminal;
