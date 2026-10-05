import React from 'react';

const SearchBar = ({ value, onChange, placeholder = 'Search...', style = {} }) => {
    return (
        <div className="search-input-wrapper" style={style}>
            <i className="bi bi-search search-icon"/>
            <input
                type="text"
                className="form-control"
                placeholder={placeholder}
                value={value}
                onChange={e => onChange(e.target.value)}
                style={{ paddingLeft: '32px' }}
            />
        </div>
    );
};

export default SearchBar;
