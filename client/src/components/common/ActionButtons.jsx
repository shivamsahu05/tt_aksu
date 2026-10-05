import React from 'react';

const ActionButtons = ({
    onView,
    onEdit,
    onDelete,
    editTitle = 'Edit',
    deleteTitle = 'Delete',
    viewTitle = 'View',
    customButtons = []
}) => {
    const btnStyle = (color) => ({
        width: '28px',
        height: '28px',
        borderRadius: '6px',
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontSize: '13px',
        cursor: 'pointer',
        border: '1px solid',
        transition: 'all 150ms ease',
        background: 'transparent',
        padding: 0,
    });

    const variants = {
        info:    { color: 'var(--info)',    borderColor: 'rgba(59,130,246,0.25)',   bg: 'rgba(59,130,246,0.06)'   },
        primary: { color: 'var(--accent)',  borderColor: 'rgba(99,102,241,0.25)',  bg: 'rgba(99,102,241,0.06)'  },
        danger:  { color: 'var(--danger)',  borderColor: 'rgba(239,68,68,0.25)',   bg: 'rgba(239,68,68,0.06)'   },
        success: { color: 'var(--success)', borderColor: 'rgba(34,197,94,0.25)',   bg: 'rgba(34,197,94,0.06)'   },
        warning: { color: 'var(--warning)', borderColor: 'rgba(245,158,11,0.25)',  bg: 'rgba(245,158,11,0.06)'  },
    };

    const Btn = ({ onClick, icon, title, colorKey = 'primary' }) => {
        const v = variants[colorKey] || variants.primary;
        const [hovered, setHovered] = React.useState(false);
        return (
            <button
                type="button"
                onClick={onClick}
                title={title}
                style={{
                    ...btnStyle(v.color),
                    color: v.color,
                    borderColor: v.borderColor,
                    background: hovered ? v.bg : 'transparent',
                }}
                onMouseEnter={() => setHovered(true)}
                onMouseLeave={() => setHovered(false)}
            >
                <i className={`bi ${icon}`}/>
            </button>
        );
    };

    return (
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: '4px' }}>
            {customButtons.map((btn, idx) => (
                <Btn key={idx} onClick={btn.onClick} icon={btn.icon} title={btn.title} colorKey={btn.color || 'primary'}/>
            ))}
            {onView && <Btn onClick={onView} icon="bi-eye" title={viewTitle} colorKey="info"/>}
            {onEdit && <Btn onClick={onEdit} icon="bi-pencil" title={editTitle} colorKey="primary"/>}
            {onDelete && <Btn onClick={onDelete} icon="bi-trash" title={deleteTitle} colorKey="danger"/>}
        </div>
    );
};

export default ActionButtons;
